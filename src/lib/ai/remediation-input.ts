import type {
  CheckEvidence,
  CheckResult,
} from "@/lib/checks/types";

export interface RemediationEvidenceInput extends CheckEvidence {
  originalIndex: number;
}

export interface RemediationCheckInput {
  id: string;
  category: CheckResult["category"];
  name: string;
  status: CheckResult["status"];
  summary: string;
  evidence: RemediationEvidenceInput[];
}

export const MAX_REMEDIATION_INPUT_CHARS = 28_000;
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
  const selected = checks
    .filter(
      (check) =>
        check.status === "failed" ||
        check.status === "blocked" ||
        check.status === "error"
    )
    .sort((a, b) => Number(b.status === "failed") - Number(a.status === "failed"))
    .slice(0, MAX_REMEDIATION_CHECKS)
    .map((check) => ({
      id: check.id,
      category: check.category,
      name: check.name,
      status: check.status,
      summary: truncateText(
        check.summary,
        MAX_SUMMARY_LENGTH
      ),
      evidence: [] as RemediationEvidenceInput[],
    }));

  // Reserve each check's identity and summary before assigning evidence space.
  let used = JSON.stringify(selected).length;
  for (const check of selected) {
    const source = checks.find((candidate) => candidate.id === check.id);
    if (!source) continue;
    const ranked = (source.evidence ?? [])
      .map((evidence, index) => ({ evidence, index }))
      .sort((a, b) => {
        const score = (item: CheckEvidence) =>
          Number(Boolean(item.file)) * 4 + Number(Boolean(item.line)) * 2 +
          Number(Boolean(item.code)) + Number(item.kind === "error" || item.kind === "security_finding");
        return score(b.evidence) - score(a.evidence) || a.index - b.index;
      })
      .slice(0, MAX_EVIDENCE_PER_CHECK);
    for (const item of ranked) {
      const evidence = { ...sanitizeEvidenceForAi(item.evidence), originalIndex: item.index };
      const cost = JSON.stringify(evidence).length + 1;
      if (used + cost > MAX_REMEDIATION_INPUT_CHARS) continue;
      check.evidence.push(evidence);
      used += cost;
    }
  }
  return selected;
}
