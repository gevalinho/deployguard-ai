import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import type {
  ArtifactAccessCapability,
} from "@/lib/remediation/artifact-access-capability";

export interface SignedArtifactAccessCapability {
  capability: ArtifactAccessCapability;
  signature: string;
}

function serializeCapability(
  capability: ArtifactAccessCapability
): string {
  return JSON.stringify({
    consumer: capability.consumer,
    artifactSha256:
      capability.artifactSha256,
    permission:
      capability.permission,
    issuedAt:
      capability.issuedAt,
    expiresAt:
      capability.expiresAt,
  });
}

function createSignature(
  capability: ArtifactAccessCapability,
  secret: string
): string {
  return createHmac(
    "sha256",
    secret
  )
    .update(
      serializeCapability(
        capability
      )
    )
    .digest("hex");
}

export function signArtifactAccessCapability(
  capability: ArtifactAccessCapability,
  secret: string
): SignedArtifactAccessCapability {
  if (!secret) {
    throw new Error(
      "Artifact capability signing secret is required."
    );
  }

  return {
    capability,
    signature:
      createSignature(
        capability,
        secret
      ),
  };
}

export function verifySignedArtifactAccessCapability(
  signed:
    SignedArtifactAccessCapability,
  secret: string
): boolean {
  if (
    !secret ||
    !signed.signature
  ) {
    return false;
  }

  const expectedSignature =
    createSignature(
      signed.capability,
      secret
    );

  const actualBuffer =
    Buffer.from(
      signed.signature,
      "hex"
    );

  const expectedBuffer =
    Buffer.from(
      expectedSignature,
      "hex"
    );

  if (
    actualBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    actualBuffer,
    expectedBuffer
  );
}