import assert from "node:assert/strict";
import { handleDeveloperDeliveryPost, handleDeveloperDeliveryGet, type DeliveryApiDependencies } from "@/lib/remediation/developer-delivery-api";
import type { TrustedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";
import type { RemediationDeliveryMetadata } from "@/lib/remediation/remediation-delivery-repository";

const artifact: TrustedArtifactMetadata = {
  id: "artifact123", repositoryIdentity: "owner/repository", format: "unified_diff",
  sha256: "a".repeat(64), byteSize: 12, createdAt: new Date(), sourceCommitSha: "b".repeat(40),
  sourceBranch: "main", ingestionSource: "verified-cache", ingestionRemoteVerified: true,
};
const delivery: RemediationDeliveryMetadata = {
  id: "delivery123", artifactId: artifact.id, repositoryIdentity: artifact.repositoryIdentity,
  originalHead: artifact.sourceCommitSha!, sourceBranch: "main",
  branchName: `deployguard/remediation-${artifact.sha256.slice(0, 12)}`,
  preparedDiffSha256: "c".repeat(64), status: "PUSHED", commitSha: "d".repeat(40), remoteName: "origin",
  createdAt: new Date(), updatedAt: new Date(), committedAt: new Date(), pushedAt: new Date(),
};
function post(body: unknown): Request {
  return new Request("https://deployguard.test/api/remediation/delivery", {
    method: "POST", headers: { origin: "https://deployguard.test", "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
function dependencies(overrides: Partial<DeliveryApiDependencies> = {}): DeliveryApiDependencies {
  const base: DeliveryApiDependencies = {
    session: () => ({ githubId: "123", login: "developer", expiresAt: Date.now() + 1000 }),
    authorize: async () => true, artifact: async () => artifact,
    claim: async () => ({ kind: "existing", delivery }), attach: async () => true,
    workspace: async () => ({ path: "/tmp/stub-only", provenance: { source: "fresh-remote", remoteVerified: true,
      commitSha: artifact.sourceCommitSha!, sourceBranch: "main" }, cleanup: async () => {} }),
    refreshPr: async (_delivery, recorded) => recorded,
    reverify: async () => true, delivery: async () => delivery, pr: async () => null,
    prepare: async () => ({ status: "prepared", artifactId: artifact.id, delivery, summary: "safe" }),
    commit: async () => ({ status: "committed", deliveryId: delivery.id, delivery, summary: "safe" }),
    push: async () => ({ status: "pushed", delivery, summary: "safe" }),
  };
  return { ...base, ...overrides };
}
async function check() {
  const input = { artifactId: artifact.id, confirmDelivery: true };
  assert.equal((await handleDeveloperDeliveryPost(post(input), dependencies({ session: () => null }))).status, 401);
  assert.equal((await handleDeveloperDeliveryPost(post(input), dependencies({ authorize: async () => false }))).status, 403);
  assert.equal((await handleDeveloperDeliveryPost(post({ ...input, repositoryIdentity: "other/repo" }), dependencies())).status, 400);
  assert.equal((await handleDeveloperDeliveryPost(post({ ...input, branchName: "main" }), dependencies())).status, 400);
  assert.equal((await handleDeveloperDeliveryPost(post({ ...input, sourceCommitSha: "e".repeat(40) }), dependencies())).status, 400);
  assert.equal((await handleDeveloperDeliveryPost(post({ ...input, repositoryPath: "/tmp/evil" }), dependencies())).status, 400);
  assert.equal((await handleDeveloperDeliveryPost(post({ ...input, confirmDelivery: false }), dependencies())).status, 400);
  assert.equal((await handleDeveloperDeliveryPost(post(input), dependencies({ artifact: async () => ({ ...artifact, ingestionRemoteVerified: false }) }))).status, 404);
  assert.equal((await handleDeveloperDeliveryPost(post(input), dependencies({ artifact: async () => ({ ...artifact, ingestionSource: "fresh-ttl-cache" }) }))).status, 404);
  assert.equal((await handleDeveloperDeliveryPost(post(input), dependencies({ claim: async () => ({ kind: "existing", delivery: { ...delivery, repositoryIdentity: "other/repo" } }) }))).status, 409);
  assert.equal((await handleDeveloperDeliveryPost(post(input), dependencies({ claim: async () => ({ kind: "pending" }) }))).status, 409);
  assert.equal((await handleDeveloperDeliveryPost(post(input), dependencies({ artifact: async () => ({ ...artifact, repositoryIdentity: "other/repo" }), authorize: async (_developer, identity) => identity === "owner/repository" }))).status, 403);
  for (const origin of [null, "https://evil.test"]) {
    const request = post(input);
    if (origin) request.headers.set("origin", origin); else request.headers.delete("origin");
    assert.equal((await handleDeveloperDeliveryPost(request, dependencies())).status, 403);
  }
  assert.equal((await handleDeveloperDeliveryGet(new Request("https://deployguard.test"), delivery.id,
    dependencies({ authorize: async () => false }))).status, 403);
  const existing = await handleDeveloperDeliveryPost(post(input), dependencies());
  assert.equal(existing.status, 200);
  assert.deepEqual(Object.keys((await existing.json()).delivery).sort(),
    ["artifactId", "deliveryId", "repositoryIdentity", "status", "branchName", "commitSha", "pushedAt"].sort());
  let prepareCalls = 0; let pushCalls = 0; let claimed = false;
  const flow = dependencies({
    claim: async () => { if (claimed) return { kind: "pending" }; claimed = true;
      return { kind: "acquired", claim: { artifactId: artifact.id, repositoryIdentity: artifact.repositoryIdentity, deliveryId: null } }; },
    prepare: async () => { prepareCalls++; return { status: "prepared", artifactId: artifact.id, delivery: { ...delivery, status: "PREPARED", commitSha: null, remoteName: null }, summary: "safe" }; },
    commit: async () => ({ status: "committed", deliveryId: delivery.id, delivery: { ...delivery, status: "COMMITTED", remoteName: null }, summary: "safe" }),
    push: async () => { pushCalls++; return { status: "pushed", delivery, summary: "safe" }; },
  });
  const [first, second] = await Promise.all([
    handleDeveloperDeliveryPost(post(input), flow), handleDeveloperDeliveryPost(post(input), flow),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [201, 409]);
  assert.equal(prepareCalls, 1); assert.equal(pushCalls, 1);
  assert.equal((await handleDeveloperDeliveryGet(new Request("https://deployguard.test/api/remediation/delivery/delivery123"), delivery.id, dependencies({ session: () => null }))).status, 401);
  const fail = await handleDeveloperDeliveryPost(post(input), dependencies({
    claim: async () => ({ kind: "acquired", claim: { artifactId: artifact.id, repositoryIdentity: artifact.repositoryIdentity, deliveryId: null } }),
    prepare: async () => { throw new Error("Authorization: Bearer secret-token /tmp/secret"); },
  }));
  assert.equal(fail.status, 503);
  assert(!JSON.stringify(await fail.json()).includes("secret-token"));
  const status = await handleDeveloperDeliveryGet(new Request("https://deployguard.test/api/remediation/delivery/delivery123"), delivery.id, dependencies({
    pr: async () => ({ deliveryId: delivery.id, provider: "github", repositoryIdentity: artifact.repositoryIdentity,
      status: "VERIFIED", prNumber: 1, prUrl: "https://github.com/owner/repository/pull/1", prState: "open",
      createdAt: new Date(), attemptedAt: null, verifiedAt: new Date(), reconciledAt: null }),
  }));
  assert.equal(status.status, 200);
  assert.equal((await status.json()).delivery.pullRequest.number, 1);
  for (const phase of ["CLAIMED", "POST_ATTEMPTED"] as const) {
    const response = await handleDeveloperDeliveryGet(new Request("https://deployguard.test"), delivery.id, dependencies({
      pr: async () => ({ deliveryId: delivery.id, provider: "github", repositoryIdentity: artifact.repositoryIdentity,
        status: phase, prNumber: null, prUrl: null, prState: null, createdAt: new Date(), attemptedAt: null,
        verifiedAt: null, reconciledAt: null }),
    }));
    const body = await response.json();
    assert.equal(body.delivery.pullRequestStatus, phase); assert.equal(body.delivery.pullRequest, undefined);
  }
  console.log("Developer delivery API boundary tests passed.");
}
check().catch(() => { console.error("Developer delivery API boundary tests failed."); process.exitCode = 1; });
