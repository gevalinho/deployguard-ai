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
const sha = "a".repeat(64), baseSha = "b".repeat(40), headSha = "c".repeat(40);
const branch = `deployguard/remediation-${sha.slice(0, 12)}`;
const secret = "test-only-signing-secret";
let state = "PUSHED", observedBase = baseSha, observedHead = headSha;
let existing = false, tokenCalls = 0, posts = 0, fetches = 0;
let throwToken = false;
const delivery = { id: "delivery", artifactId: "artifact", status: state,
  repositoryIdentity: repo, sourceBranch: "main", originalHead: baseSha,
  branchName: branch, commitSha: headSha };
stub("@/lib/remediation/remediation-delivery-repository", {
  async getRemediationDelivery() { return { ...delivery, status: state }; },
});
stub("@/lib/remediation/trusted-artifact-repository", {
  async getVerifiedArtifactMetadata() { return { id: "artifact", repositoryIdentity: repo, sha256: sha, sourceBranch: "main",
      sourceCommitSha: baseSha, ingestionSource: "fresh-remote", ingestionRemoteVerified: true }; },
});
stub("@/lib/remediation/github-app-auth", {
  async createInstallationAccessToken(owner: string, name: string, permissions: unknown) {
    tokenCalls++;
    assert.equal(`${owner}/${name}`, repo);
    assert.deepEqual(permissions, { contents: "read", pull_requests: "write" });
    if (throwToken) throw new Error("SECRET_TOKEN Authorization: Bearer secret");
    return { token: "SECRET_TOKEN", repositoryIdentity: repo,
      expiresAt: new Date(Date.now() + 60_000).toISOString() };
  },
});
const cap = require("@/lib/remediation/github-pull-request-capability") as typeof import("@/lib/remediation/github-pull-request-capability");
const { createVerifiedGitHubPullRequest } = require("@/lib/remediation/github-pull-request-delivery") as typeof import("@/lib/remediation/github-pull-request-delivery");
const signed = () => cap.signGitHubPullRequestCapability(
  cap.issueGitHubPullRequestCapability(repo, "delivery", sha, branch, headSha, "main", baseSha), secret);
const pr = () => ({ number: 7, html_url: `https://github.com/${repo}/pull/7`,
  head: { ref: branch, sha: headSha, repo: { full_name: repo } },
  base: { ref: "main", sha: baseSha, repo: { full_name: repo } } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  fetches++;
  const url = String(input);
  assert(url.startsWith(`https://api.github.com/repos/${repo}/`));
  assert.equal(init?.redirect, "error");
  if (url.includes("/branches/main")) return Response.json({ name: "main", commit: { sha: observedBase } });
  if (url.includes("/branches/deployguard%2F")) return Response.json({ name: branch, commit: { sha: observedHead } });
  if (url.includes("/pulls?")) return Response.json(existing ? [pr()] : []);
  if (url.endsWith("/pulls/7")) return Response.json(pr());
  if (url.endsWith("/pulls") && init?.method === "POST") {
    posts++;
    assert.deepEqual(JSON.parse(String(init.body)), { title: "Test", body: "Body", head: branch, base: "main" });
    return Response.json(pr());
  }
  throw new Error("Unexpected endpoint");
};
async function run() { return createVerifiedGitHubPullRequest(repo, "delivery", signed(), secret, "Test", "Body"); }
async function main() {
  state = "COMMITTED";
  assert.equal((await run()).status, "invalid_delivery_state");
  assert.equal(tokenCalls, 0);
  state = "PUSHED";
  assert.equal((await createVerifiedGitHubPullRequest("other/repo", "delivery", signed(), secret, "Test", "Body")).status, "repository_mismatch");
  assert.equal(tokenCalls, 0);
  observedBase = "d".repeat(40);
  assert.equal((await run()).status, "base_head_mismatch");
  assert.equal(posts, 0);
  observedBase = baseSha;
  observedHead = "e".repeat(40);
  assert.equal((await run()).status, "head_commit_mismatch");
  assert.equal(posts, 0);
  observedHead = headSha;
  throwToken = true;
  assert.equal((await run()).status, "github_auth_failed");
  throwToken = false;
  const created = await run();
  assert.equal(created.status, "created");
  assert.equal(created.pullRequest?.url, `https://github.com/${repo}/pull/7`);
  assert.equal(posts, 1);
  existing = true;
  assert.equal((await run()).status, "already_exists");
  assert.equal(posts, 1);
  assert(fetches > 0);
  globalThis.fetch = originalFetch;
  console.log("GitHub PR delivery safety tests passed (stubbed; no mutation).");
}
void main().catch(() => { globalThis.fetch = originalFetch; process.exitCode = 1; });
