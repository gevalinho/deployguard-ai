import type {
  CheckResult,
} from "@/lib/checks/types";

import {
  runSandboxSecurityAgent,
  parseNpmStyleAuditReport,
} from "@/lib/agents/sandbox-security-agent";

import type {
  FixProof,
} from "@/lib/remediation/types";

function hasRegression(
  checks: CheckResult[]
): boolean {
  return checks.some(
    (check) =>
      check.status === "failed"
  );
}

function hasInconclusiveRegression(
  checks: CheckResult[]
): boolean {
  return checks.some(
    (check) =>
      check.status === "blocked" || check.status === "error" ||
      (check.status === "skipped" &&
        check.skipReason !== "not_applicable" && check.skipReason !== "not_configured")
  );
}

export async function verifyDependencySecurityFix(
  repositoryPath: string,
  before: CheckResult,
  regressionChecks: CheckResult[] = [],
  targetPackageName?: string,
  requiredCheckIds: string[] = [],
): Promise<FixProof> {
  const after =
    await runSandboxSecurityAgent(
      repositoryPath
    );

  const comparison = {
    checkId: before.id,
    before,
    after,
    improved:
      before.status === "failed" &&
      after.status === "passed",
  };

  if (requiredCheckIds.some((id) =>
    regressionChecks.filter((check) => check.id === id).length !== 1)) return {
    status: "inconclusive",
    summary: "Required regression-check results were missing or duplicated.",
    comparisons: [comparison], regressionChecks,
  };

  const beforeFindings = parseNpmStyleAuditReport(before.stdout ?? "");
  const afterFindings = parseNpmStyleAuditReport(after.stdout ?? "");
  if (!beforeFindings || !afterFindings) return {
    status: "inconclusive",
    summary: "A complete before and after npm audit report is required to prove remediation.",
    comparisons: [comparison], regressionChecks,
  };
  const targetWasPresent = !targetPackageName || beforeFindings.some(
    (finding) => finding.packageName.toLowerCase() === targetPackageName.toLowerCase()
  );
  const targetRemains = !!targetPackageName && afterFindings.some(
    (finding) => finding.packageName.toLowerCase() === targetPackageName.toLowerCase()
  );

  if (
    after.status === "blocked" ||
    after.status === "error"
  ) {
    return {
      status: "inconclusive",
      summary:
        "DeployGuard could not obtain sufficient security evidence to prove the remediation.",
      comparisons: [
        comparison,
      ],
      regressionChecks,
    };
  }

  if (after.status !== "passed") {
    const partial = beforeFindings.length > 0 &&
      afterFindings.length > 0 && afterFindings.length < beforeFindings.length;
    return {
      status: "not_proven",
      summary:
        partial
          ? `Partial remediation: audit findings decreased from ${beforeFindings.length} to ${afterFindings.length}, but vulnerabilities remain.`
          : "The dependency security finding remains after the remediation attempt.",
      comparisons: [
        comparison,
      ],
      regressionChecks,
    };
  }

  if (!targetWasPresent || targetRemains) {
    return {
      status: "inconclusive",
      summary: "The targeted package finding could not be confirmed resolved from before and after audit results.",
      comparisons: [comparison], regressionChecks,
    };
  }

  if (afterFindings.some((finding) => finding.severity === "high" || finding.severity === "critical")) {
    return {
      status: "inconclusive", summary: "The after audit still contains high-risk findings.",
      comparisons: [comparison], regressionChecks,
    };
  }

  if (
    hasInconclusiveRegression(
      regressionChecks
    )
  ) {
    return {
      status: "inconclusive",
      summary:
        "The security finding was removed, but required regression evidence was unavailable or incomplete.",
      comparisons: [
        comparison,
      ],
      regressionChecks,
    };
  }

  if (hasRegression(regressionChecks)) {
    return {
      status: "not_proven",
      summary: "The security finding was removed, but regression checks reported a failure.",
      comparisons: [comparison], regressionChecks,
    };
  }

  return {
    status: "proven",
    summary:
      regressionChecks.length > 0
        ? "The original dependency security failure was removed and the supplied regression checks remained acceptable."
        : "The original dependency security failure was removed and no supplied regression check reported a failure.",
    comparisons: [
      comparison,
    ],
    regressionChecks,
  };
}
