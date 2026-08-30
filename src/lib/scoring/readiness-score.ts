import type { CheckResult } from "@/lib/checks/types";

export interface ReadinessScore {
  score: number;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export function calculateReadinessScore(
  checks: CheckResult[]
): ReadinessScore {
  const total = checks.length;

  const passed = checks.filter(
    (check) => check.status === "passed"
  ).length;

  const failed = checks.filter(
    (check) => check.status === "failed"
  ).length;

  const skipped = checks.filter(
    (check) => check.status === "skipped"
  ).length;

  if (total === 0) {
    return {
      score: 0,
      passed,
      failed,
      skipped,
      total,
    };
  }

  const score = Math.round((passed / total) * 100);

  return {
    score,
    passed,
    failed,
    skipped,
    total,
  };
}