import type { CheckResult } from "@/lib/checks/types";

import type {
  RemediationAction,
  RemediationAnalysis,
} from "@/lib/agents/remediation-agent";

export interface RemediationVerificationResult {
  summary: string;
  acceptedActions: RemediationAction[];
  rejectedActions: RemediationAction[];
}

function isValidEvidenceIndex(
  index: number,
  evidenceCount: number
): boolean {
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < evidenceCount
  );
}

function isEligibleCheck(
  check: CheckResult
): boolean {
  return (
    check.status === "failed" ||
    check.status === "blocked" ||
    check.status === "error"
  );
}

export function verifyRemediationAnalysis(
  checks: CheckResult[],
  analysis: RemediationAnalysis
): RemediationVerificationResult {
  const eligibleChecks = new Map(
    checks
      .filter(isEligibleCheck)
      .map((check) => [
        check.id,
        check,
      ])
  );

  const acceptedActions: RemediationAction[] = [];
  const rejectedActions: RemediationAction[] = [];

  for (const action of analysis.actions) {
    const check =
      eligibleChecks.get(action.checkId);

    if (!check) {
      rejectedActions.push(action);
      continue;
    }

    const evidence =
      check.evidence ?? [];

    const evidenceIndexes =
      action.evidenceIndexes;

    const indexesAreValid =
      Array.isArray(evidenceIndexes) &&
      evidenceIndexes.every((index) =>
        isValidEvidenceIndex(
          index,
          evidence.length
        )
      );

    if (!indexesAreValid) {
      rejectedActions.push(action);
      continue;
    }

    /*
     * If structured evidence exists for this check,
     * require the AI remediation to reference at
     * least one evidence item.
     *
     * If no structured evidence exists, an empty
     * evidenceIndexes array is allowed.
     */
    if (
      evidence.length > 0 &&
      evidenceIndexes.length === 0
    ) {
      rejectedActions.push(action);
      continue;
    }

    /*
     * A check without structured evidence must not
     * receive invented evidence references.
     */
    if (
      evidence.length === 0 &&
      evidenceIndexes.length > 0
    ) {
      rejectedActions.push(action);
      continue;
    }

    acceptedActions.push(action);
  }

  return {
    summary: analysis.summary,
    acceptedActions,
    rejectedActions,
  };
}