import { describe, expect, it, vi } from "vitest";
import { deliveryApiDependencies, handleDeveloperDeliveryPost, validArtifact } from "@/lib/remediation/developer-delivery-api";
import type { TrustedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";

const artifact: TrustedArtifactMetadata = {
  id: "artifact123", repositoryIdentity: "owner/repo", format: "unified_diff",
  sha256: "b".repeat(64), byteSize: 12, createdAt: new Date(),
  sourceCommitSha: "a".repeat(40), sourceBranch: "main",
  ingestionSource: "verified-cache", ingestionRemoteVerified: true,
};

describe("persisted artifact delivery eligibility", () => {
  it("accepts only remotely verified sources", () => {
    expect(validArtifact(artifact)).toBe(true);
    expect(validArtifact({ ...artifact, ingestionSource: "fresh-remote" })).toBe(true);
    expect(validArtifact({ ...artifact, ingestionSource: "fresh-ttl-cache" })).toBe(false);
    expect(validArtifact({ ...artifact, ingestionSource: "stale-fallback-cache" })).toBe(false);
    expect(validArtifact({ ...artifact, ingestionRemoteVerified: false })).toBe(false);
  });

  it("uses the persisted ID at immediate delivery lookup and creates no claim for unverified cache evidence", async () => {
    let stored: TrustedArtifactMetadata = { ...artifact, ingestionSource: "fresh-ttl-cache", ingestionRemoteVerified: false };
    const lookup = vi.fn(async (id: string) => id === stored.id ? stored : null);
    const authorize = vi.fn(async () => false);
    const claim = vi.fn();
    const deps = { ...deliveryApiDependencies,
      session: () => ({ githubId: "1", login: "developer", expiresAt: Date.now() + 60_000 }),
      artifact: lookup, authorize, claim };
    const request = () => new Request("https://deployguard.test/api/remediation/delivery", {
      method: "POST", headers: { origin: "https://deployguard.test" },
      body: JSON.stringify({ artifactId: stored.id, confirmDelivery: true }),
    });
    expect((await handleDeveloperDeliveryPost(request(), deps)).status).toBe(404);
    expect(lookup).toHaveBeenCalledWith(artifact.id);
    expect(authorize).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    stored = { ...artifact };
    expect((await handleDeveloperDeliveryPost(request(), deps)).status).toBe(403);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ githubId: "1" }), "owner/repo");
    expect(claim).not.toHaveBeenCalled();
  });
});
