import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/database/prisma";
import { getRemediationDelivery, type RemediationDeliveryMetadata } from "@/lib/remediation/remediation-delivery-repository";

export interface DeliveryClaim { artifactId: string; repositoryIdentity: string; deliveryId: string | null }
export type ClaimResult = { kind: "acquired"; claim: DeliveryClaim } |
  { kind: "existing"; delivery: RemediationDeliveryMetadata } |
  { kind: "pending" } | { kind: "conflict" };

export async function claimDeveloperDelivery(artifactId: string, repositoryIdentity: string, githubId: string): Promise<ClaimResult> {
  try {
    await prisma.remediationDeliveryRequest.create({ data: { artifactId, repositoryIdentity, developerGitHubId: githubId } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return readClaim(artifactId, repositoryIdentity);
  }
  // A legacy/manual delivery may predate this claim table. Never create a second one.
  const deliveries = await prisma.remediationDelivery.findMany({ where: { artifactId }, take: 2 });
  if (deliveries.length > 1) return { kind: "conflict" };
  if (deliveries.length === 1) {
    const delivery = deliveries[0];
    if (delivery.repositoryIdentity !== repositoryIdentity) return { kind: "conflict" };
    const linked = await prisma.remediationDeliveryRequest.updateMany({
      where: { artifactId, repositoryIdentity, deliveryId: null }, data: { deliveryId: delivery.id },
    });
    return linked.count === 1 ? { kind: "existing", delivery } : { kind: "conflict" };
  }
  return { kind: "acquired", claim: { artifactId, repositoryIdentity, deliveryId: null } };
}
export async function readClaim(artifactId: string, repositoryIdentity: string): Promise<ClaimResult> {
  const claim = await prisma.remediationDeliveryRequest.findUnique({ where: { artifactId } });
  if (!claim || claim.repositoryIdentity !== repositoryIdentity) return { kind: "conflict" };
  if (!claim.deliveryId) return { kind: "pending" };
  const delivery = await getRemediationDelivery(claim.deliveryId);
  if (!delivery || delivery.artifactId !== artifactId || delivery.repositoryIdentity !== repositoryIdentity)
    return { kind: "conflict" };
  return { kind: "existing", delivery };
}
export async function attachClaimedDelivery(artifactId: string, repositoryIdentity: string, deliveryId: string): Promise<boolean> {
  const result = await prisma.remediationDeliveryRequest.updateMany({
    where: { artifactId, repositoryIdentity, deliveryId: null }, data: { deliveryId },
  });
  return result.count === 1;
}
