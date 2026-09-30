import "dotenv/config";
import childProcess, { type ExecFileOptions } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { GitPushTransport } from "@/lib/remediation/git-push-executor";

const identity = "gevalinho/deployguard-lint-fixture";
const repositoryPath = "/home/gevalinho/hackathon/deployguard-lint-delivery-test";
const remote = `https://github.com/${identity}.git`;
const commit = "57b64cc5fd7452ab9daf3b34253a45c9cee4a0e6";
const require = createRequire(join(process.cwd(), "package.json"));

export type FailureClass = "AUTHENTICATION_FAILED" | "AUTHORIZATION_FAILED" |
  "REPOSITORY_NOT_FOUND" | "TOKEN_SCOPE_INVALID" | "TOKEN_EXPIRED" |
  "OBJECT_UNAVAILABLE" | "GIT_CONFIG_INVALID" | "NETWORK_FAILURE" | "UNKNOWN_SAFE_FAILURE";

// Inspect only in memory; never return excerpts, exception messages, or matches.
export function classifyFailure(error: unknown): FailureClass {
  const data = error as { stderr?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const diagnostic = [data?.stderr, data?.message, data?.code, data?.cause?.code]
    .filter((value): value is string => typeof value === "string").join(" ");
  if (/could not resolve|ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|timed out|failed to connect|network is unreachable|SSL certificate/i.test(diagnostic)) return "NETWORK_FAILURE";
  if (/bad config|invalid config|missing config|bogus config|config environment|protocol .*not allowed/i.test(diagnostic)) return "GIT_CONFIG_INVALID";
  if (/bad object|not a valid object|could not get object|unable to read|missing blob|missing tree|bad tree|bad revision/i.test(diagnostic)) return "OBJECT_UNAVAILABLE";
  if (/repository not found|status 404|error: 404/i.test(diagnostic)) return "REPOSITORY_NOT_FOUND";
  if (/authentication failed|invalid username|bad credentials|status 401|error: 401|could not read Username/i.test(diagnostic)) return "AUTHENTICATION_FAILED";
  if (/permission denied|write access.*not granted|not accessible by integration|status 403|error: 403/i.test(diagnostic)) return "AUTHORIZATION_FAILED";
  return "UNKNOWN_SAFE_FAILURE";
}

/** An allowlist, not a blacklist: push (including --dry-run) can never execute. */
export function allowedGit(args: string[]): boolean {
  const key = JSON.stringify(args);
  const allowed = [
    ["rev-parse", "--git-path", "objects"], ["rev-parse", "--git-path", "shallow"],
    ["rev-parse", "--is-bare-repository"],
    ["config", "--get-urlmatch", "http.extraheader", remote],
    ["cat-file", "-e", `${commit}^{commit}`],
    ["rev-list", "--objects", "--missing=print", commit],
    ["ls-remote", "--refs", "--", remote, "refs/heads/main"],
  ];
  return allowed.some((candidate) => JSON.stringify(candidate) === key) ||
    (args.length === 4 && args[0] === "init" && args[1] === "--bare" && args[2] === "--template=" &&
      dirname(args[3]) === tmpdir() && args[3].startsWith(join(tmpdir(), "deployguard-push-")));
}

export async function diagnose(): Promise<void> {
  const originalExec = childProcess.execFile;
  const originalFetch = globalThis.fetch;
  const execute = promisify(originalExec);
  let active = "SETUP";
  let transport: GitPushTransport | undefined;
  let shallowPath = "";
  let headerEffective = false;
  let lastFailure: FailureClass = "UNKNOWN_SAFE_FAILURE";
  let installationSeen = false, tokenSeen = false, contentsWrite = false, scopedResponse = false;
  const report = (label: string, status: "PASS" | "FAIL" | FailureClass) => console.log(`${label}=${status}`);
  // This test-only instrumentation observes the exact production environment.
  // Authenticated stdout/stderr stay in memory and never reach console or disk.
  const intercepted = Object.assign(() => { throw new Error("Diagnostic execution denied"); }, {
    [promisify.custom]: async (command: string, args: string[], options: ExecFileOptions) => {
      if (command !== "git" || !allowedGit(args)) throw new Error("Diagnostic execution denied");
      try {
        const result = await execute(command, args, options);
        const stdout = String(result.stdout);
        if (args.join(" ") === "rev-parse --git-path shallow") shallowPath = resolve(repositoryPath, stdout.trim());
        if (args[0] === "config") {
          const env = options.env!;
          const expected = [
            "'credential.helper='", "'http.followRedirects=false'", "'http.sslVerify=true'",
            `'http.${remote}.extraheader=${stdout.trim()}'`,
          ].join(" ");
          const configValid = env.GIT_CONFIG_COUNT === undefined && env.GIT_CONFIG_PARAMETERS === expected;
          report("CONFIG_PAIRS", configValid ? "PASS" : "GIT_CONFIG_INVALID");
          headerEffective = configValid && /^Authorization: Basic [A-Za-z0-9+/]+=*$/.test(stdout.trim());
          report("HEADER_URL_MATCH", headerEffective ? "PASS" : "GIT_CONFIG_INVALID");
          report("HTTPS_ONLY", env.GIT_ALLOW_PROTOCOL === "https" ? "PASS" : "GIT_CONFIG_INVALID");
          report("HOME_ISOLATION", env.HOME === options.cwd && env.XDG_CONFIG_HOME === options.cwd &&
            env.GIT_CONFIG_NOSYSTEM === "1" && env.GIT_CONFIG_GLOBAL === "/dev/null" ? "PASS" : "GIT_CONFIG_INVALID");
          const source = await readFile(shallowPath, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null; throw error;
          });
          const copied = await readFile(join(String(options.cwd), "shallow"), "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null; throw error;
          });
          report("SHALLOW_BOUNDARY", source === copied ? "PASS" : "GIT_CONFIG_INVALID");
        }
        if (args[0] === "rev-list") report("OBJECT_GRAPH", stdout.split("\n").some((line) => line.startsWith("?")) ? "OBJECT_UNAVAILABLE" : "PASS");
        if (args.join(" ") === "rev-parse --is-bare-repository") report("BARE_CONTEXT", stdout.trim() === "true" ? "PASS" : "GIT_CONFIG_INVALID");
        return result;
      } catch (error) {
        lastFailure = classifyFailure(error);
        if (args[0] === "config") {
          headerEffective = false;
          lastFailure = "GIT_CONFIG_INVALID";
          report("HEADER_URL_MATCH", "GIT_CONFIG_INVALID");
        }
        throw new Error("Diagnostic Git command failed");
      }
    },
  });
  childProcess.execFile = intercepted as unknown as typeof childProcess.execFile;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const lookup = url === `https://api.github.com/repos/${identity}/installation` && !init?.method;
    const mint = /^https:\/\/api\.github\.com\/app\/installations\/\d+\/access_tokens$/.test(url) && init?.method === "POST";
    if (!lookup && !mint) throw new Error("Diagnostic request denied");
    if (mint && String(init?.body) !== JSON.stringify({ repositories: ["deployguard-lint-fixture"], permissions: { contents: "write", pull_requests: "write" } })) {
      lastFailure = "TOKEN_SCOPE_INVALID"; throw new Error("Invalid token request");
    }
    try {
      const response = await originalFetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) { lastFailure = httpFailure(response.status); throw new Error("API failed"); }
      const data = await response.clone().json();
      if (lookup) {
        installationSeen = typeof data.id === "number";
        report("INSTALLATION_EXISTS", installationSeen ? "PASS" : "UNKNOWN_SAFE_FAILURE");
        report("INSTALLATION_CONTENTS_WRITE", data.permissions?.contents === "write" ? "PASS" : "AUTHORIZATION_FAILED");
      }
      if (mint) {
        tokenSeen = typeof data.token === "string" && data.token.length > 0;
        contentsWrite = data.permissions?.contents === "write";
        report("TOKEN_CREATED", tokenSeen ? "PASS" : "UNKNOWN_SAFE_FAILURE");
        report("TOKEN_CONTENTS_WRITE", contentsWrite ? "PASS" : "AUTHORIZATION_FAILED");
      }
      return response;
    } catch (error) {
      const classified = classifyFailure(error);
      if (classified !== "UNKNOWN_SAFE_FAILURE") lastFailure = classified;
      throw new Error("Diagnostic API failed");
    }
  };
  try {
    const { createGitHubAppPushTransport } = require("@/lib/remediation/github-app-git-transport") as typeof import("@/lib/remediation/github-app-git-transport");
    const { createInstallationAccessToken } = require("@/lib/remediation/github-app-auth") as typeof import("@/lib/remediation/github-app-auth");
    active = "AUTHORIZATION";
    const open = createGitHubAppPushTransport(async (owner, repository) => {
      if (`${owner}/${repository}` !== identity) { lastFailure = "TOKEN_SCOPE_INVALID"; throw new Error("Invalid scope"); }
      const access = await createInstallationAccessToken(owner, repository);
      if (access.repositoryIdentity !== identity) { lastFailure = "TOKEN_SCOPE_INVALID"; throw new Error("Invalid scope"); }
      report("RETURNED_REPOSITORY_IDENTITY", "PASS");
      if (!Number.isFinite(Date.parse(access.expiresAt)) || Date.parse(access.expiresAt) <= Date.now()) {
        lastFailure = "TOKEN_EXPIRED"; throw new Error("Invalid expiry");
      }
      report("TOKEN_UNEXPIRED", "PASS");
      const response = await originalFetch("https://api.github.com/installation/repositories?per_page=100", {
        headers: { Authorization: `Bearer ${access.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
        redirect: "error", signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) { lastFailure = httpFailure(response.status); throw new Error("Scope verification failed"); }
      const data = await response.json();
      scopedResponse = data.total_count === 1 && data.repositories?.length === 1 && data.repositories[0].full_name === identity;
      report("TOKEN_REPOSITORY_SCOPE", scopedResponse ? "PASS" : "TOKEN_SCOPE_INVALID");
      if (!installationSeen || !tokenSeen || !contentsWrite || !scopedResponse) {
        lastFailure = !scopedResponse ? "TOKEN_SCOPE_INVALID" : "AUTHORIZATION_FAILED";
        throw new Error("Token verification failed");
      }
      return access;
    });
    transport = await open({ repositoryPath, repositoryIdentity: identity, remoteUrl: remote });
    async function probe(stage: string, args: string[]) {
      active = stage; lastFailure = "UNKNOWN_SAFE_FAILURE";
      const result = await transport!.run(args);
      report(stage, result.status === "passed" ? "PASS" : lastFailure);
      if (args[0] === "ls-remote") report("PRODUCTION_AUTHENTICATED_READ",
        !headerEffective ? "GIT_CONFIG_INVALID" : result.status === "passed" ? "PASS" : lastFailure);
      if (result.status !== "passed") process.exitCode = 1;
    }
    await probe("BARE_SETUP", ["rev-parse", "--is-bare-repository"]);
    await probe("GIT_CONFIGURATION", ["config", "--get-urlmatch", "http.extraheader", remote]);
    await probe("COMMIT_OBJECT_VISIBLE", ["cat-file", "-e", `${commit}^{commit}`]);
    await probe("OBJECT_GRAPH_READABLE", ["rev-list", "--objects", "--missing=print", commit]);
    await probe("PRODUCTION_READ_ONLY_GIT", ["ls-remote", "--refs", "--", remote, "refs/heads/main"]);

  } catch (error) {
    const classified = classifyFailure(error);
    report(active, classified !== "UNKNOWN_SAFE_FAILURE" ? classified : lastFailure);
    process.exitCode = 1;
  } finally {
    try { await transport?.dispose(); } catch { report("TEMPORARY_CLEANUP", "UNKNOWN_SAFE_FAILURE"); }
    childProcess.execFile = originalExec;
    globalThis.fetch = originalFetch;
  }
}
export function httpFailure(status: number): FailureClass {
  if (status === 401) return "AUTHENTICATION_FAILED";
  if (status === 403) return "AUTHORIZATION_FAILED";
  if (status === 404) return "REPOSITORY_NOT_FOUND";
  if (status >= 500 || status === 429) return "NETWORK_FAILURE";
  return "UNKNOWN_SAFE_FAILURE";
}
if (require.main === module) {
  void diagnose().catch(() => { console.error("DIAGNOSTIC=UNKNOWN_SAFE_FAILURE"); process.exitCode = 1; });
}
