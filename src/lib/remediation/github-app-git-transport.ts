import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createInstallationAccessToken } from "@/lib/remediation/github-app-auth";
import type { GitPushTransportFactory } from "@/lib/remediation/git-push-executor";

const exec = promisify(execFile);

/** Exact GitHub identity only: no credentials, query, port, or alternate host. */
export function githubRemoteMatches(identity: string, remote: string): boolean {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(identity) ||
      identity.split("/")[1] === "." || identity.split("/")[1] === "..") return false;
  return [
    `https://github.com/${identity}`, `https://github.com/${identity}.git`,
    `git@github.com:${identity}`, `git@github.com:${identity}.git`,
    `ssh://git@github.com/${identity}`, `ssh://git@github.com/${identity}.git`,
  ].includes(remote);
}

/** Dependency injection is for trusted server tests, never request-supplied options. */
export function createGitHubAppPushTransport(
  issueToken = createInstallationAccessToken,
): GitPushTransportFactory {
  return async ({ repositoryPath, repositoryIdentity, remoteUrl }) => {
    if (!githubRemoteMatches(repositoryIdentity, remoteUrl)) {
      throw new Error("GitHub push repository identity mismatch.");
    }
    const directory = await mkdtemp(join(tmpdir(), "deployguard-push-"));
    // An allowlist excludes tracing, askpass, proxies, config injection, SSH,
    // and inherited credentials. No authenticated process reads source config.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      NODE_ENV: process.env.NODE_ENV,
      HOME: directory,
      XDG_CONFIG_HOME: directory,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ALLOW_PROTOCOL: "https",
      LC_ALL: "C",
    };
    try {
      const objects = await exec("git", ["rev-parse", "--git-path", "objects"], {
        cwd: repositoryPath, env, timeout: 30_000,
      });
      await exec("git", ["init", "--bare", "--template=", directory], {
        env, timeout: 30_000,
      });
      env.GIT_OBJECT_DIRECTORY = resolve(repositoryPath, objects.stdout.trim());
      // Ingestion uses shallow clones. Preserve their object-graph boundary
      // without importing any source repository configuration.
      const shallowPath = await exec("git", ["rev-parse", "--git-path", "shallow"], {
        cwd: repositoryPath, env, timeout: 30_000,
      });
      const shallow = await readFile(resolve(repositoryPath, shallowPath.stdout.trim()), "utf8")
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (shallow !== null) {
        if (!/^(?:[a-f0-9]{40}\n)+$/.test(shallow)) {
          throw new Error("Invalid shallow repository boundary.");
        }
        await writeFile(join(directory, "shallow"), shallow, { mode: 0o600 });
      }
      const [owner, repository] = repositoryIdentity.split("/");
      const access = await issueToken(owner, repository);
      if (access.repositoryIdentity !== repositoryIdentity || !access.token ||
          !Number.isFinite(Date.parse(access.expiresAt)) ||
          Date.parse(access.expiresAt) <= Date.now()) {
        throw new Error("Invalid installation token scope or expiry.");
      }
      const remote = `https://github.com/${repositoryIdentity}.git`;
      const config = [
        ["credential.helper", ""],
        ["http.followRedirects", "false"],
        ["http.sslVerify", "true"],
        [`http.${remote}.extraheader`, `Authorization: Basic ${Buffer.from(`x-access-token:${access.token}`).toString("base64")}`],
      ];
      env.GIT_CONFIG_COUNT = String(config.length);
      config.forEach(([key, value], index) => {
        env[`GIT_CONFIG_KEY_${index}`] = key;
        env[`GIT_CONFIG_VALUE_${index}`] = value;
      });
      return {
        remote,
        async run(args) {
          try {
            const result = await exec("git", args, {
              cwd: directory, env, timeout: 30_000, maxBuffer: 1024 * 1024,
            });
            // Push progress is deliberately discarded. Verification exposes
            // only a strictly parsed SHA/ref record, never arbitrary output.
            const stdout = args[0] === "ls-remote" &&
              /^[a-f0-9]{40}\trefs\/heads\/deployguard\/remediation-[a-f0-9]{12}\n?$/.test(result.stdout)
              ? result.stdout : "";
            return { status: "passed", stdout };
          } catch {
            return { status: "failed", stdout: "" };
          }
        },
        async dispose() {
          for (const key of Object.keys(env)) delete env[key];
          await rm(directory, { recursive: true, force: true });
        },
      };
    } catch {
      for (const key of Object.keys(env)) delete env[key];
      await rm(directory, { recursive: true, force: true });
      throw new Error("GitHub App push authentication failed.");
    }
  };
}

export const openGitHubAppPushTransport = createGitHubAppPushTransport();
