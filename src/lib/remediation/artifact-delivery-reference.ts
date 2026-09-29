import type { TrustedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";
import type { RepositoryIngestionProvenance } from "@/lib/repository/repository-ingestion";

/** Evidence comparison, not authorization. Only trusted ingestion supplies current. */
export function matchesVerifiedArtifactProvenance(
  artifact: TrustedArtifactMetadata,
  current: RepositoryIngestionProvenance,
): boolean {
  const verifiedSource = (source: unknown) => source === "fresh-remote" || source === "verified-cache";
  if (!current) return false;
  return artifact.ingestionRemoteVerified === true && current.remoteVerified === true &&
    verifiedSource(artifact.ingestionSource) && verifiedSource(current.source) &&
    typeof artifact.sourceCommitSha === "string" && /^[a-f0-9]{40}$/.test(artifact.sourceCommitSha) &&
    typeof artifact.sourceBranch === "string" && artifact.sourceBranch.length > 0 &&
    artifact.sourceCommitSha === current.commitSha && artifact.sourceBranch === current.sourceBranch;
}
