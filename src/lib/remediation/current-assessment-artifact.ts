export interface AssessmentSourceIdentity {
  repositoryIdentity: string;
  sourceCommitSha?: string;
}

export interface RemediationArtifactOutcome {
  repositoryIdentity: string;
  sourceCommitSha?: string;
  proofStatus?: string;
  artifactId?: string;
  deliveryEligible?: boolean;
}

/** An artifact belongs to this assessment only when its verified source matches. */
export function currentAssessmentArtifact(
  assessment: AssessmentSourceIdentity,
  outcome?: RemediationArtifactOutcome | null,
): { artifactId: string; deliveryEligible: boolean } | null {
  if (!outcome || !assessment.sourceCommitSha || !/^[a-f0-9]{40}$/.test(assessment.sourceCommitSha) ||
      outcome.repositoryIdentity !== assessment.repositoryIdentity ||
      outcome.sourceCommitSha !== assessment.sourceCommitSha ||
      outcome.proofStatus !== "proven" || !outcome.artifactId) return null;
  return { artifactId: outcome.artifactId, deliveryEligible: outcome.deliveryEligible === true };
}
