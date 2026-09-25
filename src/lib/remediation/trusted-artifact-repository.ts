import {
  prisma,
} from "@/lib/database/prisma";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

export interface TrustedArtifactMetadata {
  id: string;

  repositoryIdentity: string;

  format: string;

  sha256: string;

  byteSize: number;

  createdAt: Date;
}

export interface TrustedStoredArtifact
  extends TrustedArtifactMetadata {
  content: string;
}

export async function persistVerifiedArtifact(
  repositoryIdentity: string,
  artifact: VerifiedPatchArtifact
): Promise<TrustedArtifactMetadata> {
  const stored =
    await prisma
      .verifiedRemediationArtifact
      .create({
        data: {
          repositoryIdentity,

          format:
            artifact.format,

          sha256:
            artifact.sha256,

          byteSize:
            artifact.byteSize,

          content:
            artifact.content,
        },

        select: {
          id: true,

          repositoryIdentity:
            true,

          format: true,

          sha256: true,

          byteSize: true,

          createdAt: true,
        },
      });

  return stored;
}

export async function getTrustedVerifiedArtifact(
  id: string
): Promise<
  TrustedStoredArtifact | null
> {
  return prisma
    .verifiedRemediationArtifact
    .findUnique({
      where: {
        id,
      },

      select: {
        id: true,

        repositoryIdentity:
          true,

        format: true,

        sha256: true,

        byteSize: true,

        content: true,

        createdAt: true,
      },
    });
}

export async function getVerifiedArtifactMetadata(
  id: string
): Promise<
  TrustedArtifactMetadata | null
> {
  return prisma
    .verifiedRemediationArtifact
    .findUnique({
      where: {
        id,
      },

      select: {
        id: true,

        repositoryIdentity:
          true,

        format: true,

        sha256: true,

        byteSize: true,

        createdAt: true,
      },
    });
}