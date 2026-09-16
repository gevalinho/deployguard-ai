import type {
  ArchitectureAnalysis,
  ArchitectureRisk,
  RiskSeverity,
} from "@/lib/agents/architect-agent";

import {
  isRecord,
  isStringArray,
} from "@/lib/ai/response-validation";

const RISK_SEVERITIES: RiskSeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

function isRiskSeverity(
  value: unknown
): value is RiskSeverity {
  return (
    typeof value === "string" &&
    RISK_SEVERITIES.includes(
      value as RiskSeverity
    )
  );
}

function isArchitectureRisk(
  value: unknown
): value is ArchitectureRisk {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.title === "string" &&
    isRiskSeverity(value.severity) &&
    typeof value.reason === "string" &&
    isStringArray(value.evidenceKeys) &&
    isStringArray(value.researchUrls) &&
    typeof value.inference === "boolean"
  );
}

export function validateArchitectureAnalysis(
  value: unknown
): ArchitectureAnalysis {
  if (!isRecord(value)) {
    throw new Error(
      "AI architecture response must be an object."
    );
  }

  if (typeof value.summary !== "string") {
    throw new Error(
      "AI architecture response has an invalid summary."
    );
  }

  if (
    typeof value.architectureType !==
    "string"
  ) {
    throw new Error(
      "AI architecture response has an invalid architectureType."
    );
  }

  if (
    !isStringArray(
      value.recommendedChecks
    )
  ) {
    throw new Error(
      "AI architecture response has an invalid recommendedChecks array."
    );
  }

  if (!Array.isArray(value.risks)) {
    throw new Error(
      "AI architecture response has an invalid risks array."
    );
  }

  if (
    !value.risks.every(
      isArchitectureRisk
    )
  ) {
    throw new Error(
      "AI architecture response contains an invalid risk."
    );
  }

  return {
    summary: value.summary,
    architectureType:
      value.architectureType,
    recommendedChecks:
      value.recommendedChecks,
    risks: value.risks,
  };
}