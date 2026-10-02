import assert from "node:assert/strict";
import { prisma } from "@/lib/database/prisma";
import { claimDeveloperDelivery, attachClaimedDelivery } from "@/lib/remediation/developer-delivery-claim";
import { claimPullRequestDelivery, markPullRequestPostAttempted, persistVerifiedPullRequest, getDurablePullRequestDelivery } from "@/lib/remediation/github-pull-request-repository";

async function main() {
  // Explicit isolated local database required. Never default to the application's .env.
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  assert(url.pathname === "/deployguard_test", "Use only a disposable deployguard_test database");
  const artifact = await prisma.verifiedRemediationArtifact.create({ data: {
    repositoryIdentity: "owner/repo", format: "unified_diff", sha256: "a".repeat(64), byteSize: 0, content: "",
  } });
  let deliveryId: string | undefined;
  try {
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimDeveloperDelivery(artifact.id, "owner/repo", "123")));
    assert.equal(claims.filter(result => result.kind === "acquired").length, 1);
    assert(claims.every(result => ["acquired", "pending"].includes(result.kind)));
    const delivery = await prisma.remediationDelivery.create({ data: {
      artifactId: artifact.id, repositoryIdentity: "owner/repo", sourceBranch: "main", originalHead: "b".repeat(40),
      branchName: "deployguard/remediation-aaaaaaaaaaaa", preparedDiffSha256: "c".repeat(64),
    } });
    deliveryId = delivery.id;
    assert(await attachClaimedDelivery(artifact.id, "owner/repo", delivery.id));
    assert.equal((await claimDeveloperDelivery(artifact.id, "owner/repo", "123")).kind, "existing");
    assert.equal((await claimDeveloperDelivery(artifact.id, "other/repo", "123")).kind, "conflict");
    const prClaims = await Promise.all(Array.from({ length: 8 }, () => claimPullRequestDelivery(delivery.id, "owner/repo")));
    assert.equal(prClaims.filter(Boolean).length, 1);
    const attempts = await Promise.all(Array.from({ length: 8 }, () => markPullRequestPostAttempted(delivery.id)));
    assert.equal(attempts.filter(Boolean).length, 1);
    assert.equal(await claimPullRequestDelivery(delivery.id, "owner/repo"), false);
    assert.equal(await markPullRequestPostAttempted(delivery.id), false);
    const writes = await Promise.all(Array.from({ length: 8 }, () => persistVerifiedPullRequest(delivery.id, "owner/repo", 1, "https://github.com/owner/repo/pull/1", "open", true)));
    assert(writes.every(Boolean));
    assert.equal((await getDurablePullRequestDelivery(delivery.id))?.status, "VERIFIED");
    assert.equal(await persistVerifiedPullRequest(delivery.id, "owner/repo", 2, "https://github.com/owner/repo/pull/2", "open", true), false);
    assert.equal(await markPullRequestPostAttempted(delivery.id), false);
    console.log("Database-backed delivery/PR claim concurrency and immutable identity tests passed.");
  } finally {
    if (deliveryId) await prisma.gitHubPullRequestDelivery.deleteMany({ where: { deliveryId } });
    await prisma.remediationDeliveryRequest.deleteMany({ where: { artifactId: artifact.id } });
    await prisma.remediationDelivery.deleteMany({ where: { artifactId: artifact.id } });
    await prisma.verifiedRemediationArtifact.delete({ where: { id: artifact.id } });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
