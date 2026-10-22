import type { CheckCategory, CheckResult } from "@/lib/checks/types";
import type { ReadinessScore } from "./readiness-score";

/**
 * Version 1 policy: every applicable category is required evidence.
 * Only an explicit, unanimous skipped/not_applicable result removes a
 * category. There is no percentage threshold and no inferred applicability.
 */
export type ReadinessVerdictStatus = "ready" | "not_ready" | "undetermined";
export type ReadinessVerdictReason =
  | "all_applicable_checks_passed"
  | "confirmed_check_failure"
  | "required_check_not_configured"
  | "zero_evaluated_weight"
  | "required_evidence_missing"
  | "required_evidence_blocked"
  | "required_evidence_unsupported"
  | "required_evidence_error"
  | "applicability_unknown"
  | "legacy_report_missing_verdict";

export interface ReadinessVerdictV1 {
  version: 1;
  status: ReadinessVerdictStatus;
  reasonCodes: ReadinessVerdictReason[];
  affectedCategories: CheckCategory[];
}

const KNOWN_REASONS = new Set<ReadinessVerdictReason>([
  "all_applicable_checks_passed", "confirmed_check_failure", "required_check_not_configured",
  "zero_evaluated_weight", "required_evidence_missing", "required_evidence_blocked",
  "required_evidence_unsupported", "required_evidence_error", "applicability_unknown",
  "legacy_report_missing_verdict",
]);
const KNOWN_CATEGORIES = new Set<CheckCategory>([
  "build", "types", "lint", "test", "security", "database", "deployment", "environment",
]);

export function calculateReadinessVerdict(
  checks: readonly CheckResult[],
  readiness: ReadinessScore,
): ReadinessVerdictV1 {
  const reasons = new Set<ReadinessVerdictReason>();
  const affected = new Set<CheckCategory>();
  const categories = readiness.breakdown.map((item) => item.category);

  // A confirmed repository defect disqualifies readiness even if other
  // categories could not be evaluated.
  for (const check of checks) {
    if (check.status === "failed") {
      reasons.add("confirmed_check_failure");
      affected.add(check.category);
    } else if (check.status === "skipped" && check.skipReason === "not_configured" &&
      check.requiredForReadiness === true) {
      reasons.add("required_check_not_configured");
      affected.add(check.category);
    }
  }
  if (reasons.size > 0) {
    return { version: 1, status: "not_ready",
      reasonCodes: [...reasons], affectedCategories: categories.filter((category) => affected.has(category)) };
  }

  if (readiness.evaluatedWeight === 0) reasons.add("zero_evaluated_weight");
  for (const item of readiness.breakdown) {
    const categoryChecks = checks.filter((check) => check.category === item.category);
    if (item.status === "not_applicable") continue;
    const blocked = categoryChecks.some((check) => check.status === "blocked");
    const errored = categoryChecks.some((check) => check.status === "error");
    const unsupported = categoryChecks.some((check) =>
      check.status === "skipped" && check.skipReason === "unsupported");
    const missing = item.status !== "passed" || categoryChecks.length === 0 ||
      categoryChecks.some((check) => check.status === "skipped");
    if (!blocked && !errored && !unsupported && !missing) continue;
    affected.add(item.category);
    if (blocked) reasons.add("required_evidence_blocked");
    if (errored) reasons.add("required_evidence_error");
    if (unsupported) reasons.add("required_evidence_unsupported");
    if (missing && !blocked && !errored && !unsupported)
      reasons.add("required_evidence_missing");
    if (categoryChecks.length === 0 || categoryChecks.some((check) =>
      check.status === "skipped" && !check.skipReason))
      reasons.add("applicability_unknown");
  }
  if (readiness.evaluatedWeight < readiness.applicableWeight &&
      !reasons.has("required_evidence_blocked") &&
      !reasons.has("required_evidence_error") &&
      !reasons.has("required_evidence_unsupported"))
    reasons.add("required_evidence_missing");
  if (reasons.size > 0) {
    return { version: 1, status: "undetermined",
      reasonCodes: [...reasons], affectedCategories: categories.filter((category) => affected.has(category)) };
  }
  return { version: 1, status: "ready",
    reasonCodes: ["all_applicable_checks_passed"], affectedCategories: [] };
}

/** Missing or unrecognized legacy verdicts cannot be promoted to ready. */
export function resolveReadinessVerdict(
  report: { readinessVerdict?: ReadinessVerdictV1 },
): ReadinessVerdictV1 {
  const verdict = report.readinessVerdict;
  if (verdict?.version === 1 &&
      ["ready", "not_ready", "undetermined"].includes(verdict.status) &&
      Array.isArray(verdict.reasonCodes) && verdict.reasonCodes.length > 0 &&
      verdict.reasonCodes.every((reason) => KNOWN_REASONS.has(reason)) &&
      Array.isArray(verdict.affectedCategories) &&
      verdict.affectedCategories.every((category) => KNOWN_CATEGORIES.has(category)) &&
      (verdict.status !== "ready" ||
        (verdict.reasonCodes.length === 1 && verdict.reasonCodes[0] === "all_applicable_checks_passed" &&
          verdict.affectedCategories.length === 0)))
    return verdict;
  return { version: 1, status: "undetermined",
    reasonCodes: ["legacy_report_missing_verdict"], affectedCategories: [] };
}
