import type {
  CheckEvidence,
  CheckResult,
} from "@/lib/checks/types";

export interface RemediationCheckInput {
  id: string;
  category: CheckResult["category"];
  name: string;
  status: CheckResult["status"];
  summary: string;
  evidence: CheckEvidence[];
}

const MAX_REMEDIATION_CHECKS = 12;
const MAX_EVIDENCE_PER_CHECK = 10;
const MAX_SUMMARY_LENGTH = 1_000;
const MAX_EVIDENCE_MESSAGE_LENGTH = 1_500;

function truncateText(
  value: string,
  maxLength: number
): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(
    0,
    maxLength
  )}… [truncated]`;
}

function sanitizeEvidenceForAi(
  evidence: CheckEvidence
): CheckEvidence {
  return {
    ...evidence,
    message: truncateText(
      evidence.message,
      MAX_EVIDENCE_MESSAGE_LENGTH
    ),
  };
}

export function createRemediationCheckInputs(
  checks: CheckResult[]
): RemediationCheckInput[] {
  return checks
    .filter(
      (check) =>
        check.status === "failed" ||
        check.status === "blocked" ||
        check.status === "error"
    )
    .slice(
      0,
      MAX_REMEDIATION_CHECKS
    )
    .map((check) => ({
      id: check.id,
      category: check.category,
      name: check.name,
      status: check.status,
      summary: truncateText(
        check.summary,
        MAX_SUMMARY_LENGTH
      ),
      evidence: (
        check.evidence ?? []
      )
        .slice(
          0,
          MAX_EVIDENCE_PER_CHECK
        )
        .map(
          sanitizeEvidenceForAi
        ),
    }));
}