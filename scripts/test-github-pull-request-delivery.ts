import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { join } from "node:path";
const require = createRequire(join(process.cwd(), "package.json"));
function stub(path: string, exports: Record<string, unknown>) {
  const id = require.resolve(path); const cachedModule = new Module(id);
  cachedModule.exports = exports; require.cache[id] = cachedModule;
}
const repo = "gevalinho/deployguard-lint-fixture";
const sha = "a".repeat(64), baseSha = "b".repeat(40), headSha = "c".repeat(40);
const branch = `deployguard/remediation-${sha.slice(0, 12)}`;
const secret = "test-only-signing-secret";
let state = "PUSHED", source = "verified-cache", remoteVerified = true;
let artifactIdentity = repo, artifactSha = sha, sourceBranch = "main", artifactSourceBranch = "main";
let base = baseSha, head = headSha, tokenFails = false, persistenceFails = false, persistFails = false;
let remote: "none" | "one" | "two" = "none", prState: "open" | "closed" = "open";
let postMode: "normal" | "timeout_found" | "timeout_none" | "malformed" = "normal";
let row: { status: "CLAIMED" | "POST_ATTEMPTED" | "VERIFIED"; prNumber: number | null;
  prUrl: string | null; provider: string; repositoryIdentity: string } | null = null;
let posts = 0, claims = 0, persists = 0;
stub("@/lib/remediation/remediation-delivery-repository", {
  async getRemediationDelivery() { return { id: "delivery", artifactId: "artifact", status: state,
    repositoryIdentity: repo, sourceBranch, originalHead: baseSha,
    branchName: branch, commitSha: headSha }; },
});
stub("@/lib/remediation/trusted-artifact-repository", {
  async getVerifiedArtifactMetadata() { return { id: "artifact", repositoryIdentity: artifactIdentity, sha256: artifactSha,
    sourceBranch: artifactSourceBranch, sourceCommitSha: baseSha, ingestionSource: source,
    ingestionRemoteVerified: remoteVerified }; },
});
stub("@/lib/remediation/github-app-auth", {
  async createInstallationAccessToken(owner: string, name: string, permissions: unknown) {
    assert.equal(`${owner}/${name}`, repo);
    assert.deepEqual(permissions, { contents: "read", pull_requests: "write" });
    if (tokenFails) throw new Error("SECRET_TOKEN Authorization: Bearer secret");
    return { token: "SECRET_TOKEN", repositoryIdentity: repo,
      expiresAt: new Date(Date.now() + 60_000).toISOString() };
  },
});
stub("@/lib/remediation/github-pull-request-repository", {
  async getDurablePullRequestDelivery() { if (persistenceFails) throw new Error("database unavailable"); return row; },
  async claimPullRequestDelivery() { claims++; if (persistenceFails) throw new Error("database unavailable");
    if (row) return false;
    row = { status: "CLAIMED", prNumber: null, prUrl: null, provider: "github", repositoryIdentity: repo };
    return true; },
  async markPullRequestPostAttempted() { if (persistenceFails || row?.status !== "CLAIMED") return false;
    row.status = "POST_ATTEMPTED"; return true; },
  async persistVerifiedPullRequest(_id: string, _repo: string, number: number, url: string) {
    persists++; if (persistenceFails || persistFails || !row) return false;
    row.status = "VERIFIED"; row.prNumber = number; row.prUrl = url; return true; },
});
const cap = require("@/lib/remediation/github-pull-request-capability") as typeof import("@/lib/remediation/github-pull-request-capability");
const { createVerifiedGitHubPullRequest } = require("@/lib/remediation/github-pull-request-delivery") as typeof import("@/lib/remediation/github-pull-request-delivery");
const signed = () => cap.signGitHubPullRequestCapability(
  cap.issueGitHubPullRequestCapability(repo, "delivery", sha, branch, headSha, sourceBranch, baseSha), secret);
const pr = () => ({ number: 7, state: prState, html_url: `https://github.com/${repo}/pull/7`,
  head: { ref: branch, sha: headSha, repo: { full_name: repo } },
  base: { ref: sourceBranch, sha: baseSha, repo: { full_name: repo } } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  assert(url.startsWith(`https://api.github.com/repos/${repo}/`));
  assert.equal(init?.redirect, "error");
  if (url.includes(`/branches/${sourceBranch}`)) return Response.json({ name: sourceBranch, commit: { sha: base } });
  if (url.includes("/branches/deployguard%2F")) return Response.json({ name: branch, commit: { sha: head } });
  if (url.includes("/pulls?")) {
    assert(url.includes("state=all"));
    return Response.json(remote === "none" ? [] : remote === "one" ? [pr()] : [pr(), pr()]);
  }
  if (url.endsWith("/pulls/7")) return Response.json(pr());
  if (url.endsWith("/pulls") && init?.method === "POST") {
    posts++; assert.equal(row?.status, "POST_ATTEMPTED");
    if (postMode === "timeout_found") { remote = "one"; throw new Error("SECRET_TOKEN timeout"); }
    if (postMode === "timeout_none") throw new Error("SECRET_TOKEN timeout");
    if (postMode === "malformed") return Response.json({ unexpected: true });
    remote = "one"; return Response.json(pr());
  }
  throw new Error("Unexpected endpoint");
};
const run = () => createVerifiedGitHubPullRequest(repo, "delivery", signed(), secret, "Test", "Body");
function reset() { row = null; remote = "none"; prState = "open"; postMode = "normal";
  state = "PUSHED"; source = "verified-cache"; remoteVerified = true;
  artifactIdentity = repo; artifactSha = sha; sourceBranch = "main"; artifactSourceBranch = "main";
  base = baseSha; head = headSha; tokenFails = false; persistenceFails = false; persistFails = false; posts = 0; claims = 0; persists = 0; }
async function main() {
  reset(); state = "COMMITTED";
  assert.equal((await run()).status, "invalid_delivery_state"); assert.equal(posts, 0);
  reset(); assert.equal((await createVerifiedGitHubPullRequest("other/repo", "delivery", signed(), secret, "Test", "Body")).status, "repository_mismatch");
  reset(); artifactIdentity = "other/repo"; assert.equal((await run()).status, "artifact_mismatch");
  reset(); artifactSha = "f".repeat(64); assert.equal((await run()).status, "invalid_remediation_branch");
  reset(); source = "fresh-ttl-cache"; assert.equal((await run()).status, "artifact_mismatch");
  reset(); remoteVerified = false; assert.equal((await run()).status, "artifact_mismatch");
  reset(); sourceBranch = "master"; artifactSourceBranch = "master";
  assert.equal((await run()).status, "created"); assert.equal(posts, 1);
  reset(); sourceBranch = "master";
  assert.equal((await run()).status, "artifact_mismatch"); assert.equal(posts, 0);
  reset(); sourceBranch = "master"; artifactSourceBranch = "master"; base = "d".repeat(40);
  assert.equal((await run()).status, "base_head_mismatch"); assert.equal(posts, 0);
  reset(); sourceBranch = "master"; artifactSourceBranch = "master"; head = "e".repeat(40);
  assert.equal((await run()).status, "head_commit_mismatch"); assert.equal(posts, 0);
  reset(); base = "d".repeat(40); assert.equal((await run()).status, "base_head_mismatch");
  reset(); head = "e".repeat(40); assert.equal((await run()).status, "head_commit_mismatch");
  reset(); tokenFails = true;
  const authFailure = await run();
  assert.equal(authFailure.status, "github_auth_failed");
  assert(!JSON.stringify(authFailure).includes("SECRET_TOKEN"));
  reset();
  const expired = cap.signGitHubPullRequestCapability(
    cap.issueGitHubPullRequestCapability(repo, "delivery", sha, branch, headSha, "main", baseSha,
      Date.now() - 600_000), secret);
  assert.equal((await createVerifiedGitHubPullRequest(repo, "delivery", expired, secret, "Test", "Body")).status, "capability_denied");
  assert.equal(posts, 0);
  reset(); assert.equal((await run()).status, "created");
  assert.equal(row?.status, "VERIFIED"); assert.equal(posts, 1); assert.equal(persists, 1);
  assert.equal((await run()).status, "already_exists"); assert.equal(posts, 1); assert.equal(claims, 1);
  reset(); remote = "one"; prState = "closed";
  assert.equal((await run()).status, "already_exists"); assert.equal(posts, 0); assert.equal(row?.status, "VERIFIED");
  reset(); remote = "two"; assert.equal((await run()).status, "pull_request_verification_failed"); assert.equal(posts, 0);
  reset(); row = { status: "CLAIMED", prNumber: null, prUrl: null, provider: "github", repositoryIdentity: repo };
  assert.equal((await run()).status, "in_progress"); assert.equal(posts, 0);
  reset(); postMode = "timeout_found";
  assert.equal((await run()).status, "already_exists"); assert.equal(posts, 1); assert.equal(row?.status, "VERIFIED");
  reset(); postMode = "timeout_none";
  const uncertain = await run();
  assert.equal(uncertain.status, "recovery_required");
  assert(!JSON.stringify(uncertain).includes("SECRET_TOKEN"));
  assert.equal(row?.status, "POST_ATTEMPTED");
  assert.equal((await run()).status, "recovery_required"); assert.equal(posts, 1);
  reset(); postMode = "malformed";
  assert.equal((await run()).status, "recovery_required"); assert.equal(posts, 1);
  reset(); persistFails = true;
  assert.equal((await run()).status, "persistence_failed"); assert.equal(posts, 1);
  assert.equal(row?.status, "POST_ATTEMPTED");
  assert.equal((await run()).status, "persistence_failed"); assert.equal(posts, 1);
  reset(); persistenceFails = true;
  assert.equal((await run()).status, "persistence_failed"); assert.equal(posts, 0);
  reset(); postMode = "normal";
  const concurrent = await Promise.all([run(), run()]);
  assert.equal(posts, 1);
  assert(concurrent.some((result) => result.status === "created"));
  assert(concurrent.every((result) => ["created", "already_exists", "in_progress"].includes(result.status)));
  globalThis.fetch = originalFetch;
  console.log("Durable GitHub PR delivery tests passed (stubbed; no mutation).");
}
void main().catch(() => { globalThis.fetch = originalFetch; process.exitCode = 1; });
