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
let remote: string, artifactIdentity: string, head: string, currentBranch: string;
let sourceSha: string, artifactSha: string, tokenIdentity: string;
let remoteVerified: boolean, tokenFailure: boolean, pushed: boolean;
let prepareCalls: number, commitCalls: number, pushCalls: number, tokenCalls: number, fetchCalls: number, gitCalls: number;
const output: string[] = [];
const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
const originalLog = console.log, originalError = console.error;
stub("dotenv/config", {});
stub("@/lib/database/prisma", { prisma: { async $disconnect() {} } });
stub("@/lib/remediation/trusted-artifact-repository", { async getVerifiedArtifactMetadata() {
  return { id: "artifact", repositoryIdentity: artifactIdentity, sha256: hash,
    sourceCommitSha: artifactSha, sourceBranch: "main", ingestionSource: "fresh-remote", ingestionRemoteVerified: remoteVerified };
} });
stub("@/lib/remediation/remediation-delivery-repository", { async getRemediationDelivery() {
  return { id: "delivery", artifactId: "artifact", repositoryIdentity: identity,
    status: pushed ? "PUSHED" : "COMMITTED", commitSha: commit, branchName: branch, sourceBranch: "main" };
} });
stub("@/lib/remediation/github-app-auth", { async createInstallationAccessToken(owner: string, repository: string) {
  tokenCalls++;
  assert.equal(`${owner}/${repository}`, identity);
  if (tokenFailure) throw new Error(secret);
  return { token: secret, repositoryIdentity: tokenIdentity, installationId: 123 };
} });
const transportModule = require("@/lib/remediation/github-app-git-transport") as typeof import("@/lib/remediation/github-app-git-transport");
stub("@/lib/remediation/github-app-git-transport", {
  githubRemoteMatches: transportModule.githubRemoteMatches,
  createGitHubAppPushTransport: (issueToken: (owner: string, repository: string) => Promise<unknown>) =>
    async () => { await issueToken(...identity.split("/") as [string, string]); },
});
stub("@/lib/remediation/remediation-delivery-pipeline", {
  async preparePersistedRemediationDelivery(...args: unknown[]) {
    prepareCalls++;
    assert.equal(args[1], identity);
    assert.deepEqual(args[4], { source: "fresh-remote", remoteVerified: true, sourceBranch: "main", commitSha: base });
    currentBranch = branch;
    return { status: "prepared", delivery: { id: "delivery" } };
  },
  async commitPersistedRemediationDelivery() { commitCalls++; head = commit; return { status: "committed" }; },
  async pushPersistedRemediationDelivery(...args: unknown[]) {
    pushCalls++;
    assert.equal(args[1], identity);
    await (args[5] as () => Promise<void>)();
    pushed = true;
    return { status: "pushed", gitPush: { commitSha: commit } };
  },
});
mock.method(childProcess, "execFileSync", (command: string, args: string[]) => {
  gitCalls++;
  assert.equal(command, "git");
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
  assert.equal(String(url), `https://api.github.com/repos/${identity}/branches/main`);
  return Response.json({ name: "main", commit: { sha: sourceSha } });
};
console.log = (...args) => { output.push(args.join(" ")); };
console.error = (...args) => { output.push(args.join(" ")); };
const { runRealGitHubAppPushTest } = require("./scripts/test-real-github-app-push") as typeof import("./test-real-github-app-push");
function reset() {
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
  } finally {
    mock.restoreAll(); globalThis.fetch = originalFetch;
    console.log = originalLog; console.error = originalError;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
  console.log("✓ Stubbed harness: opt-in, identity, remote, artifact/provenance, both modes, token scope, and redaction passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
