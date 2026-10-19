import type { RepositoryIngestionProvenance } from "@/lib/repository/repository-ingestion";
import {
  persistVerifiedArtifact,
  type TrustedArtifactMetadata,
} from "@/lib/remediation/trusted-artifact-repository";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";
import { createVerifiedPatchArtifact } from "@/lib/remediation/verified-patch-artifact";
import type { VerifiedPatch } from "@/lib/remediation/verified-patch";
import { validateDependencyMutation } from "@/lib/remediation/dependency-mutation-validator";

export interface ProvenDependencyArtifactContract {
  strategy: "dependency_security";
  patch: VerifiedPatch;
  packageName: string;
  version: string;
}

export type ProvenArtifactContract =
  | ProvenDependencyArtifactContract
  | { strategy: "lint_autofix" };

export async function persistProvenRemediationArtifact(
  repositoryIdentity: string,
  proofStatus: string,
  artifact:
    | VerifiedPatchArtifact
    | undefined,
  provenance: RepositoryIngestionProvenance | undefined,
  contract: ProvenArtifactContract,
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
    !artifact ||
    !contract ||
    (contract.strategy !== "dependency_security" && contract.strategy !== "lint_autofix")
  ) {
    return null;
  }

  // The dependency strategy may persist only the exact, independently
  // approved two-file npm mutation. Reconstruct the patch bytes at this
  // boundary so a mismatched artifact cannot acquire a durable ID.
  if (contract.strategy === "dependency_security") {
    const expected = createVerifiedPatchArtifact(contract.patch);
    if (!validateDependencyMutation(contract.patch, contract.packageName, contract.version).valid ||
        artifact.format !== expected.format || artifact.content !== expected.content ||
        artifact.sha256 !== expected.sha256 || artifact.byteSize !== expected.byteSize) return null;
  }

  return persistVerifiedArtifact(
    repositoryIdentity,
    artifact,
    provenance
  );
}
