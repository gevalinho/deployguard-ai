import type {
  CheckResult,
} from "@/lib/checks/types";

import type {
  ProductionReadinessReport,
  PublicCheckResult,
  PublicProductionReadinessReport,
} from "@/lib/reporting/types";

/*
 * Convert an internal check result into the
 * explicitly safe public representation.
 *
 * This is an allowlist. Raw stdout/stderr are
 * intentionally never copied.
 */
export function sanitizeCheckForPublic(
  check: CheckResult
): PublicCheckResult {
  return {
    id: check.id,
    category: check.category,
    name: check.name,
    status: check.status,

    ...(check.skipReason
      ? {
          skipReason:
            check.skipReason,
        }
      : {}),

    ...(check.command
      ? {
          command:
            check.command,
        }
      : {}),

    ...(check.exitCode !== undefined
      ? {
          exitCode:
            check.exitCode,
        }
      : {}),

    ...(check.durationMs !== undefined
      ? {
          durationMs:
            check.durationMs,
        }
      : {}),

    summary: check.summary,

    ...(check.evidence &&
    check.evidence.length > 0
      ? {
          evidence:
            check.evidence,
        }
      : {}),
  };
}

export function sanitizeReportForPublic(
  report: ProductionReadinessReport
): PublicProductionReadinessReport {
  return {
    ...report,

    checks:
      report.checks.map(
        sanitizeCheckForPublic
      ),
  };
}