import { prisma } from "@/lib/database/prisma";

export interface DurablePullRequestDelivery {
  deliveryId: string;
  provider: string;
  repositoryIdentity: string;
  status: "CLAIMED" | "POST_ATTEMPTED" | "VERIFIED";
  prNumber: number | null;
  prUrl: string | null;
  prState: string | null;
  createdAt: Date;
  attemptedAt: Date | null;
  verifiedAt: Date | null;
  reconciledAt: Date | null;
}

export async function getDurablePullRequestDelivery(deliveryId: string): Promise<DurablePullRequestDelivery | null> {
  return prisma.gitHubPullRequestDelivery.findUnique({ where: { deliveryId } });
}

/** The deliveryId primary key is the cross-worker claim. Only the creator may POST. */
export async function claimPullRequestDelivery(deliveryId: string, repositoryIdentity: string): Promise<boolean> {
  try {
    await prisma.gitHubPullRequestDelivery.create({
      data: { deliveryId, repositoryIdentity, provider: "github", status: "CLAIMED" },
    });
    return true;
  } catch (error) {
    const existing = await getDurablePullRequestDelivery(deliveryId);
    if (existing) return false;
    throw error;
  }
}

/** This transition is committed before POST; a crash thereafter cannot silently retry. */
export async function markPullRequestPostAttempted(deliveryId: string): Promise<boolean> {
  const result = await prisma.gitHubPullRequestDelivery.updateMany({
    where: { deliveryId, status: "CLAIMED" },
    data: { status: "POST_ATTEMPTED", attemptedAt: new Date() },
  });
  return result.count === 1;
}

export async function persistVerifiedPullRequest(
  deliveryId: string,
  repositoryIdentity: string,
  number: number,
  url: string,
  state: "open" | "closed",
  reconciled: boolean,
): Promise<boolean> {
  const existing = await getDurablePullRequestDelivery(deliveryId);
  if (!existing || existing.provider !== "github" || existing.repositoryIdentity !== repositoryIdentity) return false;
  if (existing.status === "VERIFIED") {
    if (existing.prNumber !== number || existing.prUrl !== url) return false;
    const refreshed = await prisma.gitHubPullRequestDelivery.updateMany({
      where: { deliveryId, provider: "github", repositoryIdentity, status: "VERIFIED",
        prNumber: number, prUrl: url },
      data: { prState: state, reconciledAt: new Date() },
    });
    return refreshed.count === 1;
  }
  const result = await prisma.gitHubPullRequestDelivery.updateMany({
    where: { deliveryId, provider: "github", repositoryIdentity,
      status: { in: ["CLAIMED", "POST_ATTEMPTED"] }, prNumber: null },
    data: { status: "VERIFIED", prNumber: number, prUrl: url, prState: state,
      verifiedAt: new Date(), ...(reconciled ? { reconciledAt: new Date() } : {}) },
  });
  if (result.count === 1) return true;
  const winner = await getDurablePullRequestDelivery(deliveryId);
  return winner?.status === "VERIFIED" && winner.prNumber === number && winner.prUrl === url;
}
