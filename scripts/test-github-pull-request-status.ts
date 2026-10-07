import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { join } from "node:path";
import type { DurablePullRequestDelivery } from "@/lib/remediation/github-pull-request-repository";
import type { RemediationDeliveryMetadata } from "@/lib/remediation/remediation-delivery-repository";
import type { TrustedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";

const require = createRequire(join(process.cwd(), "package.json"));
const identity = "owner/repo";
const artifact: TrustedArtifactMetadata = { id: "artifact123", repositoryIdentity: identity, format: "unified_diff",
  sha256: "a".repeat(64), byteSize: 10, createdAt: new Date(), sourceBranch: "main",
  sourceCommitSha: "b".repeat(40), ingestionSource: "fresh-remote", ingestionRemoteVerified: true };
const delivery: RemediationDeliveryMetadata = { id: "delivery123", artifactId: artifact.id, repositoryIdentity: identity,
  sourceBranch: "main", originalHead: artifact.sourceCommitSha!, branchName: "deployguard/remediation-aaaaaaaaaaaa",
  commitSha: "c".repeat(40), status: "PUSHED", preparedDiffSha256: "d".repeat(64), remoteName: "origin",
  createdAt: new Date(), updatedAt: new Date(), committedAt: new Date(), pushedAt: new Date() };
const initial: DurablePullRequestDelivery = { deliveryId: delivery.id, repositoryIdentity: identity, provider: "github",
  status: "VERIFIED", prNumber: 7, prUrl: "https://github.com/owner/repo/pull/7", prState: "open",
  createdAt: new Date(), attemptedAt: new Date(), verifiedAt: new Date(), reconciledAt: null };
let row = { ...initial }, writes = 0, reads = 0, tokens = 0, failWrite = false;
const id = require.resolve("@/lib/database/prisma");
const cachedModule = new Module(id);
cachedModule.exports = { prisma: { gitHubPullRequestDelivery: {
  async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<DurablePullRequestDelivery> }) {
    if (failWrite) throw new Error("SECRET database failure");
    for (const [key, expected] of Object.entries(where)) {
      const actual = row[key as keyof DurablePullRequestDelivery];
      if (actual instanceof Date && expected instanceof Date ? actual.getTime() !== expected.getTime() : actual !== expected) return { count: 0 };
    }
    writes++; row = { ...row, ...data }; return { count: 1 };
  },
} } };
require.cache[id] = cachedModule;
const { updateVerifiedPullRequestState } = require("@/lib/remediation/github-pull-request-repository") as typeof import("@/lib/remediation/github-pull-request-repository");
const { refreshVerifiedGitHubPullRequest } = require("@/lib/remediation/github-pull-request-status") as typeof import("@/lib/remediation/github-pull-request-status");
const { handleDeveloperDeliveryGet, deliveryApiDependencies } = require("@/lib/remediation/developer-delivery-api") as typeof import("@/lib/remediation/developer-delivery-api");
const remote = (state: "open" | "closed", merged: boolean) => ({ number: 7, html_url: initial.prUrl, state, merged,
  // Base advances after merge. No branch lookup is allowed, including deleted heads.
  base: { ref: delivery.sourceBranch, sha: "e".repeat(40), repo: { full_name: identity } },
  head: { ref: delivery.branchName, sha: delivery.commitSha, repo: { full_name: identity } } });
let payload: unknown = remote("open", false);
let httpFailure = false, networkFailure = false, wrongToken = false;
const token: typeof import("@/lib/remediation/github-app-auth").createInstallationAccessToken = async (owner, repo, permissions) => {
  tokens++; assert.equal(`${owner}/${repo}`, identity); assert.deepEqual(permissions, { pull_requests: "read" });
  return { token: "SECRET", installationId: 1, repositoryIdentity: wrongToken ? "other/repo" : identity,
    expiresAt: new Date(Date.now() + 60000).toISOString() };
};
const request: typeof fetch = async (url, init) => {
  reads++; assert.equal(String(url), "https://api.github.com/repos/owner/repo/pulls/7");
  assert.equal(init?.method, "GET"); assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error");
  if (networkFailure) throw new Error("SECRET network failure");
  return httpFailure ? new Response(null, { status: 503 }) : Response.json(payload);
};
const deps = { ...deliveryApiDependencies,
  session: () => ({ githubId: "123", login: "developer", expiresAt: Date.now() + 60000 }), authorize: async () => true,
  artifact: async () => artifact, delivery: async () => delivery, pr: async () => ({ ...row }),
  refreshPr: (d: RemediationDeliveryMetadata, p: DurablePullRequestDelivery) =>
    refreshVerifiedGitHubPullRequest(d, p, { token, request, persist: updateVerifiedPullRequestState }),
};
const get = () => handleDeveloperDeliveryGet(new Request("https://deployguard.test/api/remediation/delivery/delivery123?state=merged"), delivery.id, deps);
function reset() { row = { ...initial }; writes = 0; reads = 0; tokens = 0; failWrite = false;
  httpFailure = false; networkFailure = false; wrongToken = false; payload = remote("open", false); }
async function main() {
  for (const [state, merged, expected] of [["open", false, "open"], ["closed", true, "merged"], ["closed", false, "closed"]] as const) {
    reset(); payload = remote(state, merged);
    const response = await get(); assert.equal(response.status, 200);
    const value = (await response.json()).delivery.pullRequest;
    assert.equal(value.state, expected); assert.equal(value.url, initial.prUrl); assert.equal(value.number, 7);
    assert.equal(row.prState, expected); assert(row.reconciledAt instanceof Date);
    assert.equal(writes, 1); assert.equal(reads, 1); assert.equal(tokens, 1);
    assert.equal(row.status, "VERIFIED"); assert.equal(row.verifiedAt, initial.verifiedAt);
  }
  delivery.sourceBranch = "master"; artifact.sourceBranch = "master";
  reset(); payload = remote("open", false);
  assert.equal((await get()).status, 200);
  delivery.sourceBranch = "main"; artifact.sourceBranch = "main";
  for (const fail of [() => { httpFailure = true; }, () => { networkFailure = true; }, () => { wrongToken = true; },
    () => { payload = null; }, () => { payload = { ...remote("closed", true), number: 8 }; },
    () => { payload = { ...remote("closed", true), html_url: "https://evil.test" }; },
    () => { payload = { ...remote("open", false), merged: undefined }; },
    () => { payload = remote("open", true); },
    () => { payload = { ...remote("closed", true), head: { ...remote("closed", true).head, sha: "f".repeat(40) } }; },
    () => { payload = { ...remote("closed", true), base: { ref: "main", repo: { full_name: "other/repo" } } }; },
    () => { failWrite = true; },
  ]) {
    reset(); fail(); const response = await get(); assert.equal(response.status, 503);
    const body = await response.json(); assert.equal(body.ok, false); assert.equal(body.delivery, undefined);
    assert(!JSON.stringify(body).includes("SECRET")); assert.equal(row.prState, "open"); assert.equal(writes, 0);
  }
  reset();
  assert.equal((await handleDeveloperDeliveryGet(new Request("https://deployguard.test"), delivery.id,
    { ...deps, authorize: async () => false })).status, 403); assert.equal(reads, 0); assert.equal(tokens, 0);
  assert.equal((await handleDeveloperDeliveryGet(new Request("https://deployguard.test"), delivery.id,
    { ...deps, session: () => null })).status, 401); assert.equal(tokens, 0);
  for (const status of ["CLAIMED", "POST_ATTEMPTED"] as const) {
    reset(); row.status = status;
    assert.equal((await get()).status, 200); assert.equal(reads, 0); assert.equal(writes, 0);
  }
  reset(); const stale = { ...row };
  assert(await updateVerifiedPullRequestState(stale, "merged"));
  assert.equal(await updateVerifiedPullRequestState(stale, "open"), null); assert.equal(row.prState, "merged");
  assert.equal(await updateVerifiedPullRequestState(row, "closed"), null);
  console.log("Verified PR status reconciliation tests passed: open, merged, closed, failure, identity, authorization and stale writes.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
