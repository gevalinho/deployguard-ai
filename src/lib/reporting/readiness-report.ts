import type { ArchitectureAnalysis } from "@/lib/agents/architect-agent";
import type { CheckResult } from "@/lib/checks/types";
import type { RepositoryScanResult } from "@/lib/scanner/types";
import type {
  ProductionReadinessReport,
  RemediationItem,
} from "@/lib/reporting/types";
import type { ReadinessScore } from "@/lib/scoring/readiness-score";

function getNotConfiguredRecommendation(
  check: CheckResult
): string {
  switch (check.category) {
    case "test":
      return (
        "Add and configure an automated test suite so DeployGuard " +
        "can execute and verify application tests."
      );

    case "deployment":
      return (
        "Add a verified deployment configuration such as a Dockerfile, " +
        "Vercel configuration, or CI workflow so DeployGuard can " +
        "evaluate deployment readiness."
      );

    case "database":
      return (
        "Configure the application's database or ORM integration " +
        "so DeployGuard can validate database readiness."
      );

    case "security":
      return (
        "Configure the required security tooling so DeployGuard " +
        "can verify dependency and application security."
      );

    case "environment":
      return (
        "Document the required environment configuration so DeployGuard " +
        "can verify production environment readiness."
      );

    default:
      return (
        `Configure ${check.name.toLowerCase()} so DeployGuard ` +
        "can verify this readiness category."
      );
  }
}

function createRemediationItems(
  checks: CheckResult[]
): RemediationItem[] {
  const items: RemediationItem[] = [];

  for (const check of checks) {
    if (check.status === "failed") {
      items.push({
        category: check.category,
        priority: "high",
        title: `${check.name} failed`,
        recommendation:
          `Resolve the failure reported by the ${check.name} check ` +
          "and run the assessment again.",
      });

      continue;
    }

    if (
      check.status === "skipped" &&
      check.skipReason === "not_configured"
    ) {
      items.push({
        category: check.category,
        priority: "medium",
        title: `${check.name} is not configured`,
        recommendation: getNotConfiguredRecommendation(check),
      });

      continue;
    }

    if (
      check.status === "skipped" &&
      check.skipReason === "unsupported"
    ) {
      items.push({
        category: check.category,
        priority: "low",
        title: `${check.name} could not be evaluated`,
        recommendation:
          "This configuration is currently unsupported by DeployGuard " +
          "and requires manual verification.",
      });

      continue;
    }

    if (check.status === "error") {
      items.push({
        category: check.category,
        priority: "medium",
        title: `${check.name} could not complete`,
        recommendation:
          "Resolve the execution or infrastructure problem and run " +
          "this check again.",
      });
    }
  }

  return items;
}

export function createProductionReadinessReport(
  scan: RepositoryScanResult,
  checks: CheckResult[],
  readiness: ReadinessScore,
  architecture?: ArchitectureAnalysis
): ProductionReadinessReport {
  return {
    generatedAt: new Date().toISOString(),

    repository: {
      path: scan.repositoryPath,
      scannedAt: scan.scannedAt,
      facts: scan.facts,
    },

    architecture,

    checks,
    readiness,

    remediation: createRemediationItems(checks),
  };
}