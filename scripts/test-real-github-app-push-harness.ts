import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import childProcess from "node:child_process";
import { mock } from "node:test";
import { join } from "node:path";
// External effects are stubbed before import; no Git, network, or database calls.
const require = createRequire(join(process.cwd(), "package.json"));
function stub(path: string, exports: Record<string, unknown>) {
  const id = require.resolve(path);
  const cachedModule = new Module(id);
  cachedModule.exports = exports;
  require.cache[id] = cachedModule;
}
const identity = "example-owner/lint-fixture";
const base = "a".repeat(40), commit = "b".repeat(40), hash = "c".repeat(64);
const branch = `deployguard/remediation-${hash.slice(0, 12)}`;
const secret = "SECRET_TOKEN_PRIVATE_KEY_AUTHORIZATION";
const hostileError = `${secret} eyJhbGciOiJSUzI1NiJ9.JWT.signature Authorization: Basic SECRET_HEADER -----BEGIN PRIVATE KEY----- https://user:password@github.com/repo ENV_SECRET`;
let failureStage = "";
let returnFailure = false;
function fail(stage: string) { if (failureStage === stage) throw new Error(hostileError); }
let remote: string, artifactIdentity: string, head: string, currentBranch: string;
let sourceSha: string, artifactSha: string, tokenIdentity: string;
let remoteVerified: boolean, tokenFailure: boolean, pushed: boolean;
let prepareCalls: number, commitCalls: number, pushCalls: number, tokenCalls: number, fetchCalls: number, gitCalls: number;
const output: string[] = [];
const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
const originalLog = console.log, originalError = console.error;
stub("dotenv/config", {});
stub("@/lib/database/prisma", { prisma: { async $disconnect() { fail("cleanup"); } } });
stub("@/lib/remediation/trusted-artifact-repository", { async getVerifiedArtifactMetadata() {
  fail("artifact_lookup");
  return { id: "artifact", repositoryIdentity: artifactIdentity, sha256: hash,
    sourceCommitSha: artifactSha, sourceBranch: "main", ingestionSource: "fresh-remote", ingestionRemoteVerified: remoteVerified };
} });
stub("@/lib/remediation/remediation-delivery-repository", { async getRemediationDelivery() {
  fail(pushed ? "durable_verification" : "delivery_lookup");
  return { id: "delivery", artifactId: "artifact", repositoryIdentity: identity,
    status: pushed ? "PUSHED" : "COMMITTED", commitSha: commit, branchName: branch, sourceBranch: "main" };
} });
stub("@/lib/remediation/github-app-auth", { async createInstallationAccessToken(owner: string, repository: string) {
  tokenCalls++;
  assert.equal(`${owner}/${repository}`, identity);
  fail("github_app_authorization");
  if (tokenFailure) throw new Error(hostileError);
  return { token: secret, repositoryIdentity: tokenIdentity, installationId: 123 };
} });
const transportModule = require("@/lib/remediation/github-app-git-transport") as typeof import("@/lib/remediation/github-app-git-transport");
stub("@/lib/remediation/github-app-git-transport", {
  githubRemoteMatches: transportModule.githubRemoteMatches,
  createGitHubAppPushTransport: (issueToken: (owner: string, repository: string) => Promise<unknown>) =>
    async () => {
      await issueToken(...identity.split("/") as [string, string]);
      fail("transport_setup");
      return {
        remote: "stubbed-remote",
        async run(args: string[]) {
          const stage = args[0] === "push" ? "push_delivery" : "remote_verification";
          if (returnFailure && failureStage === stage) return { status: "failed", stdout: hostileError };
          fail(stage);
          return { status: "passed", stdout: args[0] === "ls-remote" ? `${commit}\trefs/heads/${branch}\n` : "" };
        },
        async dispose() {},
      };
    },
});
stub("@/lib/remediation/remediation-delivery-pipeline", {
  async preparePersistedRemediationDelivery(...args: unknown[]) {
    prepareCalls++;
    if (returnFailure && failureStage === "prepare_delivery") return { status: "delivery_failed", summary: hostileError };
    fail("prepare_delivery");
    assert.equal(args[1], identity);
    assert.deepEqual(args[4], { source: "fresh-remote", remoteVerified: true, sourceBranch: "main", commitSha: base });
    currentBranch = branch;
    return { status: "prepared", delivery: { id: "delivery" } };
  },
  async commitPersistedRemediationDelivery() {
    commitCalls++;
    if (returnFailure && failureStage === "commit_delivery") return { status: "commit_failed", summary: hostileError };
    fail("commit_delivery"); head = commit; return { status: "committed" };
  },
  async pushPersistedRemediationDelivery(...args: unknown[]) {
    pushCalls++;
    assert.equal(args[1], identity);
    // Simulate the production executor swallowing transport errors. Diagnostics
    // must retain the stage even when no original exception reaches the harness.
    try {
      const opened = await (args[5] as () => Promise<{
        run(args: string[]): Promise<{ status: string; stdout: string }>;
        dispose(): Promise<void>;
      }>)();
      try {
        if ((await opened.run(["push", "--", "stubbed-remote", `${commit}:refs/heads/${branch}`])).status !== "passed") {
          return { status: "push_failed", summary: hostileError };
        }
        const verification = await opened.run(["ls-remote", "--refs", "--", "stubbed-remote", `refs/heads/${branch}`]);
        if (verification.status !== "passed" || verification.stdout.trim() !== `${commit}\trefs/heads/${branch}`) {
          return { status: "push_failed", summary: hostileError, gitPush: { status: "verification_failed" } };
        }
      } finally { await opened.dispose(); }
    } catch { return { status: "push_failed", summary: hostileError }; }
    if (returnFailure && failureStage === "persist_delivery") return { status: "persistence_failed", summary: hostileError };
    fail("persist_delivery");
    pushed = true;
    return { status: "pushed", gitPush: { commitSha: commit } };
  },
});
mock.method(childProcess, "execFileSync", (command: string, args: string[]) => {
  gitCalls++;
  assert.equal(command, "git");
  fail("checkout_identity");
  switch (args.join(" ")) {
    case "remote get-url origin": return remote;
    case "status --porcelain": return "";
    case "branch --show-current": return currentBranch;
    case "rev-parse HEAD": return head;
    default: throw new Error("Unexpected Git mutation in harness");
  }
});
globalThis.fetch = async (url) => {
  fetchCalls++;
  fail("remote_provenance");
  assert.equal(String(url), `https://api.github.com/repos/${identity}/branches/main`);
  return Response.json({ name: "main", commit: { sha: sourceSha } });
};
console.log = (...args) => { output.push(args.join(" ")); };
console.error = (...args) => { output.push(args.join(" ")); };
const { runRealGitHubAppPushTest } = require("./scripts/test-real-github-app-push") as typeof import("./test-real-github-app-push");
function reset() {
  failureStage = ""; returnFailure = false;
  process.env.DEPLOYGUARD_REAL_GITHUB_PUSH_TEST = "1";
  process.env.DEPLOYGUARD_PUSH_REPOSITORY_IDENTITY = identity;
  process.env.DEPLOYGUARD_PUSH_REPOSITORY_PATH = "/isolated/stubbed-checkout";
  process.env.DEPLOYGUARD_PUSH_ARTIFACT_ID = "artifact";
  delete process.env.DEPLOYGUARD_PUSH_DELIVERY_ID;
  remote = `git@github.com:${identity}.git`;
  artifactIdentity = tokenIdentity = identity;
  sourceSha = artifactSha = head = base;
  currentBranch = "main";
  remoteVerified = true;
  tokenFailure = pushed = false;
  prepareCalls = commitCalls = pushCalls = tokenCalls = fetchCalls = gitCalls = 0;
  output.length = 0;
}
function noMutation() { assert.equal(prepareCalls + commitCalls + pushCalls + tokenCalls, 0); }
async function main() {
  try {
    reset(); delete process.env.DEPLOYGUARD_REAL_GITHUB_PUSH_TEST;
    assert(await runRealGitHubAppPushTest()); noMutation(); assert.equal(gitCalls, 0);
    for (const invalid of [undefined, "", "owner", "owner/repo/extra", "/repo", "owner/", "owner//repo", "owner/.", "owner/..", " owner/repo", "owner/repo ", "https://github.com/owner/repo", "owner/repo?token=secret", "owner/repo#ref", "owner/repo\n", "owner@host/repo"]) {
      reset();
      if (invalid === undefined) delete process.env.DEPLOYGUARD_PUSH_REPOSITORY_IDENTITY;
      else process.env.DEPLOYGUARD_PUSH_REPOSITORY_IDENTITY = invalid;
      assert.equal(await runRealGitHubAppPushTest(), false);
      noMutation(); assert.equal(gitCalls, 0);
    }
    reset(); delete process.env.DEPLOYGUARD_PUSH_REPOSITORY_PATH;
    assert.equal(await runRealGitHubAppPushTest(), false); noMutation();
    reset(); artifactIdentity = "other/repo";
    assert.equal(await runRealGitHubAppPushTest(), false); noMutation(); assert.equal(fetchCalls, 0);
    reset(); remote = "git@github.com:other/repo.git";
    assert.equal(await runRealGitHubAppPushTest(), false); noMutation(); assert.equal(fetchCalls, 0);
    for (const mismatch of ["remote", "artifact", "unverified"]) {
      reset();
      if (mismatch === "remote") sourceSha = commit;
      if (mismatch === "artifact") artifactSha = commit;
      if (mismatch === "unverified") remoteVerified = false;
      assert.equal(await runRealGitHubAppPushTest(), false); noMutation();
    }
    reset(); assert(await runRealGitHubAppPushTest());
    assert.equal(prepareCalls, 1); assert.equal(commitCalls, 1); assert.equal(tokenCalls, 1);
    assert(!output.join(" ").includes(secret));
    reset(); process.env.DEPLOYGUARD_PUSH_DELIVERY_ID = "delivery";
    currentBranch = branch; head = commit;
    assert(await runRealGitHubAppPushTest());
    assert.equal(prepareCalls + commitCalls, 0); assert.equal(pushCalls, 1);
    reset(); tokenIdentity = secret;
    assert.equal(await runRealGitHubAppPushTest(), false); assert(!pushed);
    assert(!output.join(" ").includes(secret));
    reset(); tokenFailure = true;
    assert.equal(await runRealGitHubAppPushTest(), false); assert(!pushed);
    assert(!output.join(" ").includes(secret));
    for (const stage of ["checkout_identity", "artifact_lookup", "remote_provenance",
      "prepare_delivery", "commit_delivery", "delivery_lookup", "github_app_authorization",
      "transport_setup", "push_delivery", "remote_verification", "persist_delivery",
      "durable_verification", "cleanup"]) {
      reset(); failureStage = stage;
      assert.equal(await runRealGitHubAppPushTest(), false);
      assert.deepEqual(output.filter((line) => line.startsWith("FAILED_STAGE=")), [`FAILED_STAGE=${stage}`]);
      for (const sensitive of [secret, "JWT.signature", "Authorization:", "SECRET_HEADER", "PRIVATE KEY", "user:password", "ENV_SECRET"]) {
        assert(!output.join(" ").includes(sensitive));
      }
      if (["checkout_identity", "artifact_lookup", "remote_provenance"].includes(stage)) noMutation();
      if (stage === "prepare_delivery") assert.equal(commitCalls + pushCalls + tokenCalls, 0);
      if (stage === "commit_delivery") assert.equal(pushCalls + tokenCalls, 0);
      if (stage === "github_app_authorization") assert(!output.includes("→ pushing remediation branch"));
      if (stage === "push_delivery") assert(!output.includes("→ verifying remote branch"));
      if (stage === "remote_verification") assert(!output.includes("✓ remote branch verified"));
    }
    for (const stage of ["prepare_delivery", "commit_delivery", "push_delivery", "remote_verification", "persist_delivery"]) {
      reset(); failureStage = stage; returnFailure = true;
      assert.equal(await runRealGitHubAppPushTest(), false);
      assert.deepEqual(output.filter((line) => line.startsWith("FAILED_STAGE=")), [`FAILED_STAGE=${stage}`]);
      assert(!output.join(" ").includes(secret));
    }
    reset(); delete process.env.DEPLOYGUARD_PUSH_REPOSITORY_IDENTITY;
    assert.equal(await runRealGitHubAppPushTest(), false);
    assert.deepEqual(output, ["FAILED_STAGE=configuration"]);
    reset(); process.env.DEPLOYGUARD_PUSH_DELIVERY_ID = "delivery";
    currentBranch = "wrong-branch"; head = commit;
    assert.equal(await runRealGitHubAppPushTest(), false);
    assert(output.includes("FAILED_STAGE=delivery_validation")); noMutation();
    reset(); assert(await runRealGitHubAppPushTest());
    const progress = ["✓ configuration validated", "✓ checkout identity verified",
      "✓ database/artifact loaded", "✓ remote provenance verified", "→ preparing delivery",
      "✓ delivery prepared", "→ committing delivery", "✓ delivery committed",
      "→ acquiring GitHub App installation authorization", "✓ GitHub App authorization acquired",
      "→ pushing remediation branch", "✓ remediation branch pushed",
      "→ verifying remote branch", "✓ remote branch verified"];
    let previous = -1;
    for (const message of progress) { const index = output.indexOf(message); assert(index > previous); previous = index; }
  } finally {
    mock.restoreAll(); globalThis.fetch = originalFetch;
    console.log = originalLog; console.error = originalError;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
  console.log("✓ Stubbed harness: opt-in, identity, remote, artifact/provenance, both modes, token scope, and redaction passed.");
}
main().catch(() => { console.error("Stubbed harness diagnostic test failed."); process.exitCode = 1; });
