import type { TrustedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";
import type { RepositoryIngestionProvenance, RepositoryIngestionSource } from "@/lib/repository/repository-ingestion";

/** Eligible source labels; remoteVerified and exact identities are checked separately. */
export function isRemotelyVerifiedIngestionSource(
  source: unknown,
): source is Extract<RepositoryIngestionSource, "fresh-remote" | "verified-cache"> {
  return source === "fresh-remote" || source === "verified-cache";
}

/** Evidence comparison, not authorization. Only trusted ingestion supplies current. */
export function matchesVerifiedArtifactProvenance(
  artifact: TrustedArtifactMetadata,
  current: RepositoryIngestionProvenance,
): boolean {
  if (!current) return false;
  return artifact.ingestionRemoteVerified === true && current.remoteVerified === true &&
    isRemotelyVerifiedIngestionSource(artifact.ingestionSource) && isRemotelyVerifiedIngestionSource(current.source) &&
    typeof artifact.sourceCommitSha === "string" && /^[a-f0-9]{40}$/.test(artifact.sourceCommitSha) &&
    typeof artifact.sourceBranch === "string" && artifact.sourceBranch.length > 0 &&
    artifact.sourceCommitSha === current.commitSha && artifact.sourceBranch === current.sourceBranch;
}
