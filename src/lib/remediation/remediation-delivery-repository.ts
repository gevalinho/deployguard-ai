import {
  prisma,
} from "@/lib/database/prisma";

export interface PreparedDeliveryInput {
  artifactId: string;
  repositoryIdentity: string;
  originalHead: string;
  branchName: string;
  preparedDiffSha256: string;
}

export interface RemediationDeliveryMetadata {
  id: string;
  artifactId: string;

  status:
    | "PREPARED"
    | "COMMITTED"
    | "PUSHED"
    | "FAILED";

  repositoryIdentity: string;
  originalHead: string;
  branchName: string;
  preparedDiffSha256: string;

  commitSha:
    | string
    | null;

  remoteName:
    | string
    | null;

  createdAt: Date;
  updatedAt: Date;

  committedAt:
    | Date
    | null;

  pushedAt:
    | Date
    | null;
}

export async function createPreparedDelivery(
  input: PreparedDeliveryInput
): Promise<RemediationDeliveryMetadata> {
  return prisma.remediationDelivery.create({
    data: {
      artifactId:
        input.artifactId,

      status:
        "PREPARED",

      repositoryIdentity:
        input.repositoryIdentity,

      originalHead:
        input.originalHead,

      branchName:
        input.branchName,

      preparedDiffSha256:
        input.preparedDiffSha256,
    },
  });
}

export async function markDeliveryCommitted(
  deliveryId: string,
  commitSha: string
): Promise<RemediationDeliveryMetadata | null> {
  /*
   * This conditional update makes the database
   * transition atomic.
   *
   * Only PREPARED may become COMMITTED.
   */
  const result =
    await prisma.remediationDelivery.updateMany({
      where: {
        id: deliveryId,
        status: "PREPARED",
      },

      data: {
        status: "COMMITTED",
        commitSha,
        committedAt:
          new Date(),
      },
    });

  if (result.count !== 1) {
    return null;
  }

  return prisma.remediationDelivery.findUnique({
    where: {
      id: deliveryId,
    },
  });
}

export async function markDeliveryPushed(
  deliveryId: string,
  remoteName: string
): Promise<RemediationDeliveryMetadata | null> {
  /*
   * A delivery may be recorded as PUSHED only
   * after a successful COMMITTED transition.
   */
  const result =
    await prisma.remediationDelivery.updateMany({
      where: {
        id: deliveryId,
        status: "COMMITTED",

        commitSha: {
          not: null,
        },
      },

      data: {
        status: "PUSHED",
        remoteName,
        pushedAt:
          new Date(),
      },
    });

  if (result.count !== 1) {
    return null;
  }

  return prisma.remediationDelivery.findUnique({
    where: {
      id: deliveryId,
    },
  });
}

export async function markDeliveryFailed(
  deliveryId: string
): Promise<RemediationDeliveryMetadata | null> {
  /*
   * PUSHED is terminal.
   *
   * Once the authorized commit exists remotely,
   * we must never rewrite its audit record as a
   * failure.
   */
  const result =
    await prisma.remediationDelivery.updateMany({
      where: {
        id: deliveryId,

        status: {
          in: [
            "PREPARED",
            "COMMITTED",
          ],
        },
      },

      data: {
        status: "FAILED",
      },
    });

  if (result.count !== 1) {
    return null;
  }

  return prisma.remediationDelivery.findUnique({
    where: {
      id: deliveryId,
    },
  });
}

export async function getRemediationDelivery(
  deliveryId: string
): Promise<RemediationDeliveryMetadata | null> {
  return prisma.remediationDelivery.findUnique({
    where: {
      id: deliveryId,
    },
  });
}