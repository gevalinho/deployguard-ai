import assert from "node:assert/strict";
import { handleDeveloperPullRequestPost, type PullRequestApiDependencies } from "@/lib/remediation/developer-pull-request-api";
import { verifySignedGitHubPullRequestCapability } from "@/lib/remediation/github-pull-request-capability";
import { readDeveloperSession, seal, SESSION_COOKIE } from "@/lib/auth/developer-session";
const artifact = { id: "artifact123", repositoryIdentity: "owner/repo", sha256: "a".repeat(64),
  format: "unified_diff", byteSize: 1, createdAt: new Date(), sourceBranch: "main",
  sourceCommitSha: "b".repeat(40), ingestionSource: "fresh-remote", ingestionRemoteVerified: true };
const delivery = { id: "delivery123", artifactId: artifact.id, repositoryIdentity: artifact.repositoryIdentity,
  originalHead: artifact.sourceCommitSha, sourceBranch: "main", branchName: `deployguard/remediation-${artifact.sha256.slice(0, 12)}`,
  status: "PUSHED" as const, commitSha: "c".repeat(40), preparedDiffSha256: "d".repeat(64), remoteName: "origin",
  createdAt: new Date(), updatedAt: new Date(), committedAt: new Date(), pushedAt: new Date() };
const pr = { deliveryId: delivery.id, provider: "github", repositoryIdentity: delivery.repositoryIdentity,
  status: "VERIFIED" as const, prNumber: 1, prUrl: "https://github.com/owner/repo/pull/1", prState: "open",
  createdAt: new Date(), attemptedAt: new Date(), verifiedAt: new Date(), reconciledAt: null };
let calls = 0; let authorizations = 0;
const secrets = new Set<string>();
const deps: PullRequestApiDependencies = {
  session: () => ({ githubId: "123", login: "developer", expiresAt: Date.now() + 10000 }),
  authorize: async (_session, identity) => { authorizations++; assert.equal(identity, artifact.repositoryIdentity); return true; },
  artifact: async () => artifact, delivery: async () => delivery, pr: async () => pr,
  create: async (identity, id, signed, secret, title, body) => {
    calls++; assert.equal(identity, delivery.repositoryIdentity); assert.equal(id, delivery.id);
    assert.match(secret, /^[a-f0-9]{64}$/); assert(!secrets.has(secret)); secrets.add(secret);
    assert(verifySignedGitHubPullRequestCapability(signed, secret));
    assert.deepEqual(signed.capability, { repositoryIdentity: artifact.repositoryIdentity, deliveryId: delivery.id,
      artifactSha256: artifact.sha256, headBranch: delivery.branchName, headCommitSha: delivery.commitSha,
      baseBranch: delivery.sourceBranch, baseHeadSha: delivery.originalHead,
      permission: "create_verified_remediation_pull_request", issuedAt: signed.capability.issuedAt,
      expiresAt: signed.capability.issuedAt + 300000 });
    assert(title && body); return { status: "created", summary: "DO_NOT_EXPOSE" };
  },
};
function request(body: unknown = { confirmPullRequest: true }, origin: string | null = "https://deployguard.test") {
  return new Request("https://deployguard.test/api/remediation/delivery/delivery123/pull-request", {
    method: "POST", headers: origin ? { origin } : {}, body: JSON.stringify(body),
  });
}
async function denied(status: number, overrides: Partial<PullRequestApiDependencies> = {}, req = request(), id = delivery.id) {
  const before = calls;
  assert.equal((await handleDeveloperPullRequestPost(req, id, { ...deps, ...overrides })).status, status);
  assert.equal(calls, before, "Rejected requests must never reach capability-consuming engine");
}
async function main() {
  await denied(401, { session: () => null });
  process.env.DEPLOYGUARD_SESSION_SECRET = "test-only-session-secret-at-least-32-bytes";
  const expired = request(); expired.headers.set("cookie", `${SESSION_COOKIE}=${seal({ githubId: "123", login: "developer", expiresAt: Date.now() - 1 })}`);
  await denied(401, { session: readDeveloperSession }, expired);
  await denied(403, {}, request(undefined, null));
  await denied(403, {}, request(undefined, "https://evil.test"));
  await denied(403, { authorize: async () => false });
  for (const body of [null, [], {}, { confirmPullRequest: false }, { confirmPullRequest: "true" }]) await denied(400, {}, request(body));
  for (const field of ["repositoryIdentity", "artifactId", "artifactSha256", "branchName", "headBranch", "commitSha", "baseHeadSha",
    "token", "githubToken", "capability", "signature", "title", "body", "provenance", "deliveryId", "sourceBranch"]) {
    await denied(400, {}, request({ confirmPullRequest: true, [field]: "forged" }));
  }
  const malformed = request();
  await denied(400, {}, new Request(malformed.url, { method: "POST", headers: malformed.headers, body: "{" }));
  await denied(404, {}, request(), "../bad");
  await denied(404, { delivery: async () => null });
  await denied(409, { artifact: async () => null });
  for (const changes of [{ ingestionRemoteVerified: false }, { ingestionSource: "fresh-ttl-cache" }, { repositoryIdentity: "other/repo" },
    { sourceCommitSha: "e".repeat(40) }, { id: "different123" }, { sha256: "f".repeat(64) }]) {
    await denied(409, { artifact: async () => ({ ...artifact, ...changes }) });
  }
  for (const changes of [{ status: "COMMITTED" as const }, { branchName: "main" }, { remoteName: "other" }, { pushedAt: null }, { commitSha: "bad" }]) {
    await denied(409, { delivery: async () => ({ ...delivery, ...changes }) });
  }
  await denied(409, { artifact: async () => ({ ...artifact, sourceBranch: "master" }),
    delivery: async () => ({ ...delivery, sourceBranch: "master" }) });
  for (let i = 0; i < 2; i++) {
    const response = await handleDeveloperPullRequestPost(request(), delivery.id, deps);
    assert.equal(response.status, 201); assert.equal(response.headers.get("cache-control"), "no-store");
    const data = await response.json(); assert.equal(data.delivery.pullRequest.url, pr.prUrl);
    for (const secret of [...secrets, artifact.sha256, "DO_NOT_EXPOSE", "signature", "capability"]) assert(!JSON.stringify(data).includes(secret));
  }
  assert(authorizations >= 2);
  for (const status of ["base_head_mismatch", "head_commit_mismatch", "recovery_required", "in_progress", "capability_denied"] as const) {
    const response = await handleDeveloperPullRequestPost(request(), delivery.id, { ...deps, create: async () => ({ status, summary: "SECRET" }) });
    assert.equal(response.status, 409); const data = await response.json(); assert.equal(data.code, status); assert(!JSON.stringify(data).includes("SECRET"));
  }
  assert.equal((await handleDeveloperPullRequestPost(request(), delivery.id, { ...deps, pr: async () => null })).status, 503);
  assert.equal((await handleDeveloperPullRequestPost(request(), delivery.id, { ...deps, create: async () => { throw new Error("SECRET"); } })).status, 503);
  console.log("PR API security and server authority reconstruction tests passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
