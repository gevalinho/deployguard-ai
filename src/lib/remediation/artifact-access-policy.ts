import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

import {
  validateArtifactAccessCapability,
  type ArtifactAccessCapability,
} from "@/lib/remediation/artifact-access-capability";

export type ArtifactConsumer =
  | "public_api"
  | "dashboard"
  | "trusted_agent"
  | "github_integration";

export type ArtifactAccessLevel =
  | "metadata"
  | "content";

export interface ArtifactMetadata {
  format: VerifiedPatchArtifact["format"];
  sha256: string;
  byteSize: number;
}

export interface ArtifactAccessDecision {
  consumer: ArtifactConsumer;
  access: ArtifactAccessLevel;
  metadata: ArtifactMetadata;
  content?: string;
}

function createArtifactMetadata(
  artifact: VerifiedPatchArtifact
): ArtifactMetadata {
  return {
    format: artifact.format,
    sha256: artifact.sha256,
    byteSize: artifact.byteSize,
  };
}

export function authorizeArtifactAccess(
  artifact: VerifiedPatchArtifact,
  consumer: ArtifactConsumer,
  capability?: ArtifactAccessCapability
): ArtifactAccessDecision {
  const metadata =
    createArtifactMetadata(
      artifact
    );

  switch (consumer) {
    case "public_api":
    case "dashboard":
      return {
        consumer,
        access: "metadata",
        metadata,
      };

    case "trusted_agent":
case "github_integration": {
  if (
    !capability ||
    !validateArtifactAccessCapability(
      capability,
      consumer,
      artifact.sha256
    )
  ) {
    return {
      consumer,
      access: "metadata",
      metadata,
    };
  }

  return {
    consumer,
    access: "content",
    metadata,
    content: artifact.content,
  };
}

    default: {
      const exhaustiveCheck: never =
        consumer;

      throw new Error(
        `Unsupported artifact consumer: ${exhaustiveCheck}`
      );
    }
  }
}