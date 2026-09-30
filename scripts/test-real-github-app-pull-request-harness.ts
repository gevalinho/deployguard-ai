import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { join } from "node:path";
const require = createRequire(join(process.cwd(), "package.json"));
function stub(path: string, exports: Record<string, unknown>) {
  const id = require.resolve(path);
  const cachedModule = new Module(id);
  cachedModule.exports = exports;
  require.cache[id] = cachedModule;
}
const repo = "gevalinho/deployguard-lint-fixture";
const deliveryId = "cmunyaeb30001wd0jxifmmbw9";
const base = "b33ebd64a696b5792e0cd459161fb2f8bc319125";
const head = "57b64cc5fd7452ab9daf3b34253a45c9cee4a0e6";
const sha = "9c9b23d4566b966be68e4be67469c63c8f8aced4c3be61b2bf0778d2541a0150";
const branch = "deployguard/remediation-9c9b23d4566b";
const hostile = "SECRET_TOKEN Authorization: Bearer secret PRIVATE KEY https://user:password@github.com";
let calls = 0, failAt = "", artifactSource = "verified-cache", remoteVerified = true;
const output: string[] = [];
const original = { ...process.env }, originalFetch = globalThis.fetch;
const log = console.log, error = console.error;
stub("dotenv/config", {});
stub("@/lib/database/prisma", { prisma: { async $disconnect() {} } });
stub("@/lib/remediation/remediation-delivery-repository", {
  async getRemediationDelivery() { calls++; if (failAt === "delivery_lookup") throw new Error(hostile);
    return { id: deliveryId, artifactId: "artifact", status: "PUSHED", repositoryIdentity: repo,
      sourceBranch: "main", originalHead: base, branchName: branch, commitSha: head }; },
});
stub("@/lib/remediation/trusted-artifact-repository", {
  async getVerifiedArtifactMetadata() { calls++; if (failAt === "artifact_lookup") throw new Error(hostile);
    return { id: "artifact", repositoryIdentity: repo, sha256: sha, sourceBranch: "main",
      sourceCommitSha: base, ingestionSource: artifactSource, ingestionRemoteVerified: remoteVerified }; },
});
stub("@/lib/remediation/github-app-auth", {
  async createInstallationAccessToken() { calls++; throw new Error(hostile); },
});
stub("@/lib/remediation/github-pull-request-delivery", {
  async createVerifiedGitHubPullRequest() { throw new Error("Unexpected mutation"); },
});
globalThis.fetch = async (input) => { calls++;
  const url = String(input);
  if (failAt === "remote_identity") throw new Error(hostile);
  if (url.includes("/branches/main")) return Response.json({ name: "main", commit: { sha: base } });
  if (url.includes("/branches/")) return Response.json({ name: branch, commit: { sha: head } });
  throw new Error("Unexpected remote request");
};
console.log = (...args) => { output.push(args.join(" ")); };
console.error = (...args) => { output.push(args.join(" ")); };
const { runRealGitHubAppPullRequestTest } = require("./scripts/test-real-github-app-pull-request") as typeof import("./test-real-github-app-pull-request");
async function main() {
  delete process.env.DEPLOYGUARD_REAL_GITHUB_PR_TEST;
  assert.equal(await runRealGitHubAppPullRequestTest(), true);
  assert.equal(calls, 0);
  process.env.DEPLOYGUARD_REAL_GITHUB_PR_TEST = "1";
  process.env.DEPLOYGUARD_PR_REPOSITORY_IDENTITY = "other/repo";
  process.env.DEPLOYGUARD_PR_DELIVERY_ID = deliveryId;
  assert.equal(await runRealGitHubAppPullRequestTest(), false);
  assert(output.includes("FAILED_STAGE=configuration"));
  assert.equal(calls, 0);
  process.env.DEPLOYGUARD_PR_REPOSITORY_IDENTITY = repo;
  for (const stage of ["delivery_lookup", "artifact_lookup", "remote_identity", "github_app_authorization"]) {
    failAt = stage;
    assert.equal(await runRealGitHubAppPullRequestTest(), false);
    assert(output.includes(`FAILED_STAGE=${stage}`));
  }
  failAt = "";
  artifactSource = "verified-cache";
  remoteVerified = true;
  output.length = 0;
  assert.equal(await runRealGitHubAppPullRequestTest(), false);
  assert(output.includes("✓ artifact and provenance verified"));
  assert(output.includes("FAILED_STAGE=github_app_authorization"));
  for (const invalid of ["fresh-ttl-cache", "stale-fallback-cache", "forged-source"]) {
    artifactSource = invalid;
    output.length = 0;
    assert.equal(await runRealGitHubAppPullRequestTest(), false);
    assert(output.includes("FAILED_STAGE=artifact_lookup"));
  }
  artifactSource = "verified-cache";
  remoteVerified = false;
  output.length = 0;
  assert.equal(await runRealGitHubAppPullRequestTest(), false);
  assert(output.includes("FAILED_STAGE=artifact_lookup"));
  assert(!output.join(" ").includes(hostile));
  assert(!output.join(" ").includes("SECRET_TOKEN"));
  globalThis.fetch = originalFetch;
  console.log = log; console.error = error;
  process.env = original;
  log("Real GitHub App PR harness safety tests passed (stubbed; no mutation).");
}
void main().catch(() => { globalThis.fetch = originalFetch; console.log = log; console.error = error; process.env = original; process.exitCode = 1; });
