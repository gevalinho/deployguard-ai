import type { ArchitectureAnalysis } from "@/lib/agents/architect-agent";
import type {
  CheckEvidence,
  CheckResult,
} from "@/lib/checks/types";
import type {
  ProductionReadinessReport,
  RemediationItem,
} from "@/lib/reporting/types";
import type { RepositoryScanResult } from "@/lib/scanner/types";
import type { ReadinessScore } from "@/lib/scoring/readiness-score";

const MAX_REMEDIATION_EVIDENCE = 3;

function formatEvidenceLocation(
  evidence: CheckEvidence
): string | undefined {
  if (!evidence.file) {
    return undefined;
  }

  let location = evidence.file;

  if (evidence.line !== undefined) {
    location += `:${evidence.line}`;

    if (evidence.column !== undefined) {
      location += `:${evidence.column}`;
    }
  }

  return location;
}

function formatEvidenceReference(
  evidence: CheckEvidence
): string {
  const location = formatEvidenceLocation(evidence);

  const code = evidence.code
    ? ` (${evidence.code})`
    : "";

  if (location) {
    return `${location}${code}: ${evidence.message}`;
  }

  return `${evidence.message}${code}`;
}

function getEvidenceSummary(
  check: CheckResult
): string | undefined {
  const evidence = check.evidence ?? [];

  if (evidence.length === 0) {
    return undefined;
  }

  const selectedEvidence = evidence.slice(
    0,
    MAX_REMEDIATION_EVIDENCE
  );

  const references = selectedEvidence.map(
    formatEvidenceReference
  );

  const remaining =
    evidence.length - selectedEvidence.length;

  const suffix =
    remaining > 0
      ? ` DeployGuard captured ${remaining} additional evidence item${
          remaining === 1 ? "" : "s"
        }.`
      : "";

  return `${references.join(" ")}${suffix}`;
}

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

function getFailedCheckRecommendation(
  check: CheckResult
): string {
  const evidenceSummary =
    getEvidenceSummary(check);

  if (!evidenceSummary) {
    return (
      `Resolve the failure reported by the ${check.name} check ` +
      "and run the assessment again."
    );
  }

  switch (check.category) {
    case "types":
      return (
        "Fix the captured TypeScript diagnostics before deployment. " +
        `${evidenceSummary} ` +
        "Then rerun type verification."
      );

    case "lint":
      return (
        "Fix the captured lint violations. " +
        `${evidenceSummary} ` +
        "Then rerun lint verification."
      );

    case "test":
      return (
        "Investigate and fix the failing automated tests using the " +
        `captured test evidence. ${evidenceSummary} ` +
        "Then rerun the test suite."
      );

    case "build":
      return (
        "Resolve the production build failures identified by the " +
        `sandbox build. ${evidenceSummary} ` +
        "Then rerun production build verification."
      );

    case "security":
      return (
        "Review and remediate the reported high-severity dependency " +
        `findings. ${evidenceSummary} ` +
        "Update or replace affected dependencies where appropriate, " +
        "then rerun the dependency security check."
      );

    case "database":
      return (
        "Resolve the database validation failure using the captured " +
        `evidence. ${evidenceSummary} ` +
        "Then rerun database verification."
      );

    case "deployment":
      return (
        "Resolve the deployment configuration failure using the " +
        `captured evidence. ${evidenceSummary} ` +
        "Then rerun deployment verification."
      );

    case "environment":
      return (
        "Resolve the environment readiness failure using the captured " +
        `evidence. ${evidenceSummary} ` +
        "Then rerun environment verification."
      );

    default:
      return (
        `Resolve the ${check.name} failure using the captured evidence. ` +
        `${evidenceSummary} ` +
        "Then rerun the assessment."
      );
  }
}

function getBlockedRecommendation(
  check: CheckResult
): string {
  const evidenceSummary =
    getEvidenceSummary(check);

  if (check.category === "build") {
    return (
      "The production build depends on a capability that the isolated " +
      "DeployGuard sandbox could not provide, commonly external network " +
      "access during build execution. " +
      (evidenceSummary
        ? `Captured evidence: ${evidenceSummary} `
        : "") +
      "Review the build-time dependency or allow the required resource " +
      "through a controlled verification policy, then rerun the assessment."
    );
  }

  return (
    "The check could not be fully verified because the execution " +
    "environment or verification policy blocked a required capability. " +
    (evidenceSummary
      ? `Captured evidence: ${evidenceSummary} `
      : "") +
    "Review the restriction and rerun the assessment."
  );
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
          getFailedCheckRecommendation(check),
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
        recommendation:
          getNotConfiguredRecommendation(check),
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

    if (check.status === "blocked") {
      items.push({
        category: check.category,
        priority: "medium",
        title: `${check.name} verification was blocked`,
        recommendation:
          getBlockedRecommendation(check),
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