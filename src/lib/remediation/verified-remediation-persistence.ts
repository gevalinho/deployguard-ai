import {
  persistVerifiedArtifact,
  type TrustedArtifactMetadata,
} from "@/lib/remediation/trusted-artifact-repository";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

export async function persistProvenRemediationArtifact(
  repositoryIdentity: string,
  proofStatus: string,
  artifact:
    | VerifiedPatchArtifact
    | undefined
): Promise<
  TrustedArtifactMetadata | null
> {
  /*
   * Only independently proven remediation
   * evidence may cross the durable persistence
   * boundary.
   */
  if (
    proofStatus !== "proven" ||
    !artifact
  ) {
    return null;
  }

  return persistVerifiedArtifact(
    repositoryIdentity,
    artifact
  );
}