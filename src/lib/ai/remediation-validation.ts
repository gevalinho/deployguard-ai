import type {
  RemediationAction,
  RemediationAnalysis,
  RemediationPriority,
} from "@/lib/agents/remediation-agent";

import {
  isNumberArray,
  isRecord,
} from "@/lib/ai/response-validation";

const REMEDIATION_PRIORITIES: RemediationPriority[] = [
  "low",
  "medium",
  "high",
  "critical",
];

function isRemediationPriority(
  value: unknown
): value is RemediationPriority {
  return (
    typeof value === "string" &&
    REMEDIATION_PRIORITIES.includes(
      value as RemediationPriority
    )
  );
}

function isRemediationAction(
  value: unknown
): value is RemediationAction {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.title === "string" &&
    typeof value.explanation === "string" &&
    typeof value.recommendation === "string" &&
    isRemediationPriority(value.priority) &&
    typeof value.checkId === "string" &&
    isNumberArray(value.evidenceIndexes)
  );
}

export function validateRemediationAnalysis(
  value: unknown
): RemediationAnalysis {
  if (!isRecord(value)) {
    throw new Error(
      "AI remediation response must be an object."
    );
  }

  if (typeof value.summary !== "string") {
    throw new Error(
      "AI remediation response has an invalid summary."
    );
  }

  if (!Array.isArray(value.actions)) {
    throw new Error(
      "AI remediation response has an invalid actions array."
    );
  }

  if (!value.actions.every(isRemediationAction)) {
    throw new Error(
      "AI remediation response contains an invalid action."
    );
  }

  return {
    summary: value.summary,
    actions: value.actions,
  };
}