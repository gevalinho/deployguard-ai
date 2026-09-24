import {
  createHash,
} from "node:crypto";

import {
  authorizeArtifactAccess,
  type ArtifactConsumer,
} from "@/lib/remediation/artifact-access-policy";

import type {
  SignedArtifactAccessCapability,
} from "@/lib/remediation/artifact-capability-signing";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

export type TrustedArtifactConsumer =
  Extract<
    ArtifactConsumer,
    "trusted_agent" | "github_integration"
  >;

export interface TrustedArtifactConsumptionResult {
  consumer: TrustedArtifactConsumer;

  status:
    | "consumed"
    | "denied"
    | "integrity_failed";

  artifactSha256: string;

  byteSize: number;

  content?: string;

  summary: string;
}

function calculateSha256(
  content: string
): string {
  return createHash("sha256")
    .update(content)
    .digest("hex");
}

export function consumeVerifiedArtifact(
  artifact: VerifiedPatchArtifact,
  consumer: TrustedArtifactConsumer,
  signedCapability:
    SignedArtifactAccessCapability,
  signingSecret: string
): TrustedArtifactConsumptionResult {
  const access =
    authorizeArtifactAccess(
      artifact,
      consumer,
      signedCapability,
      signingSecret
    );

  if (
    access.access !== "content" ||
    access.content === undefined
  ) {
    return {
      consumer,
      status: "denied",

      artifactSha256:
        access.metadata.sha256,

      byteSize:
        access.metadata.byteSize,

      summary:
        "Verified artifact content access was denied.",
    };
  }

  /*
   * Authorization proves that the consumer may
   * access this artifact.
   *
   * Integrity verification independently proves
   * that the content received still corresponds
   * to the immutable artifact identity.
   */

  const calculatedSha256 =
    calculateSha256(
      access.content
    );

  if (
    calculatedSha256 !==
    access.metadata.sha256
  ) {
    return {
      consumer,
      status:
        "integrity_failed",

      artifactSha256:
        access.metadata.sha256,

      byteSize:
        access.metadata.byteSize,

      summary:
        "Verified artifact content failed SHA-256 integrity verification.",
    };
  }

  const calculatedByteSize =
    Buffer.byteLength(
      access.content,
      "utf8"
    );

  if (
    calculatedByteSize !==
    access.metadata.byteSize
  ) {
    return {
      consumer,
      status:
        "integrity_failed",

      artifactSha256:
        access.metadata.sha256,

      byteSize:
        access.metadata.byteSize,

      summary:
        "Verified artifact content failed byte-size integrity verification.",
    };
  }

  return {
    consumer,
    status: "consumed",

    artifactSha256:
      access.metadata.sha256,

    byteSize:
      access.metadata.byteSize,

    content:
      access.content,

    summary:
      "Verified artifact content was authorized and passed integrity verification.",
  };
}