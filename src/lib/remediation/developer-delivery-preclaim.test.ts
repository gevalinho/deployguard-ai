import { describe, expect, it, vi } from "vitest";
import { deliveryApiDependencies, handleDeveloperDeliveryPost } from "./developer-delivery-api";
import type { TrustedArtifactMetadata } from "./trusted-artifact-repository";
import type { RemediationDeliveryMetadata } from "./remediation-delivery-repository";

const artifact: TrustedArtifactMetadata = {
  id: "artifact123", repositoryIdentity: "owner/private-repo", format: "unified_diff",
  sha256: "b".repeat(64), byteSize: 10, createdAt: new Date(),
  sourceCommitSha: "a".repeat(40), sourceBranch: "master",
  ingestionSource: "verified-cache", ingestionRemoteVerified: true,
};
const request = () => new Request("https://deployguard.test/api/remediation/delivery", {
  method: "POST", headers: { origin: "https://deployguard.test" },
  body: JSON.stringify({ artifactId: artifact.id, confirmDelivery: true }),
});

describe("delivery preclaim provenance boundary", () => {
  it("does not claim or push when workspace reconstruction fails", async () => {
    const claim = vi.fn(); const push = vi.fn();
    const response = await handleDeveloperDeliveryPost(request(), { ...deliveryApiDependencies,
      session: () => ({ githubId: "1", login: "developer", expiresAt: Date.now() + 60_000 }),
      artifact: async () => artifact, authorize: async () => true,
      workspace: async () => { throw new Error("Remote provenance mismatch."); }, claim, push });
    expect(response.status).toBe(503);
    expect(claim).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not claim when reconstructed provenance disagrees with the artifact", async () => {
    const claim = vi.fn(); const push = vi.fn(); const cleanup = vi.fn(async () => {});
    const response = await handleDeveloperDeliveryPost(request(), { ...deliveryApiDependencies,
      session: () => ({ githubId: "1", login: "developer", expiresAt: Date.now() + 60_000 }),
      artifact: async () => artifact, authorize: async () => true,
      workspace: async () => ({ path: "/unused", provenance: { source: "stale-fallback-cache",
        remoteVerified: false, commitSha: artifact.sourceCommitSha!, sourceBranch: artifact.sourceBranch! }, cleanup }),
      claim, push });
    expect(response.status).toBe(409);
    expect(claim).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("claims only after verified workspace reconstruction", async () => {
    const claim = vi.fn(async () => ({ kind: "pending" as const }));
    const cleanup = vi.fn(async () => {}); const push = vi.fn();
    const response = await handleDeveloperDeliveryPost(request(), { ...deliveryApiDependencies,
      session: () => ({ githubId: "1", login: "developer", expiresAt: Date.now() + 60_000 }),
      artifact: async () => artifact, authorize: async () => true,
      workspace: async () => ({ path: "/unused", provenance: { source: "verified-cache",
        remoteVerified: true, commitSha: artifact.sourceCommitSha!, sourceBranch: artifact.sourceBranch! }, cleanup }),
      claim, push });
    expect(response.status).toBe(409);
    expect(claim).toHaveBeenCalledWith(artifact.id, artifact.repositoryIdentity, "1");
    expect(push).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("reaches the mocked mutation boundary only after authenticated provenance and preparation", async () => {
    const events: string[] = [];
    const branchName = `deployguard/remediation-${artifact.sha256.slice(0, 12)}`;
    const base: RemediationDeliveryMetadata = { id: "delivery123", artifactId: artifact.id,
      repositoryIdentity: artifact.repositoryIdentity, originalHead: artifact.sourceCommitSha!,
      sourceBranch: artifact.sourceBranch!, branchName, preparedDiffSha256: "c".repeat(64),
      status: "PREPARED", commitSha: null, remoteName: null,
      createdAt: new Date(), updatedAt: new Date(), committedAt: null, pushedAt: null };
    const committed: RemediationDeliveryMetadata = { ...base, status: "COMMITTED", commitSha: "d".repeat(40), committedAt: new Date() };
    const pushed: RemediationDeliveryMetadata = { ...committed, status: "PUSHED", remoteName: "origin", pushedAt: new Date() };
    const response = await handleDeveloperDeliveryPost(request(), { ...deliveryApiDependencies,
      session: () => ({ githubId: "1", login: "developer", expiresAt: Date.now() + 60_000 }),
      artifact: async () => artifact, authorize: async () => true,
      workspace: async () => { events.push("workspace"); return { path: "/verified-workspace",
        provenance: { source: "verified-cache", remoteVerified: true,
          commitSha: artifact.sourceCommitSha!, sourceBranch: artifact.sourceBranch! },
        cleanup: async () => { events.push("cleanup"); } }; },
      claim: async () => { events.push("claim"); return { kind: "acquired", claim: {
        artifactId: artifact.id, repositoryIdentity: artifact.repositoryIdentity, deliveryId: null } }; },
      prepare: async (_path, _identity, _id, _secret, provenance) => {
        expect(provenance.commitSha).toBe(artifact.sourceCommitSha);
        events.push("prepare"); return { status: "prepared", artifactId: artifact.id, delivery: base, summary: "prepared" };
      },
      attach: async () => { events.push("attach"); return true; },
      commit: async () => { events.push("commit"); return { status: "committed", deliveryId: base.id,
        delivery: committed, summary: "committed" }; },
      reverify: async () => { events.push("reverify"); return true; },
      push: async () => { events.push("mock-push"); return { status: "pushed", delivery: pushed, summary: "pushed" }; },
    });
    expect(response.status).toBe(201);
    expect(events).toEqual(["workspace", "claim", "prepare", "attach", "commit", "reverify", "mock-push", "cleanup"]);
  });
});
