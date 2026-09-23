import type {
  CheckResult,
} from "@/lib/checks/types";

import {
  runSandboxSecurityAgent,
} from "@/lib/agents/sandbox-security-agent";

import type {
  FixProof,
} from "@/lib/remediation/types";

function hasRegression(
  checks: CheckResult[]
): boolean {
  return checks.some(
    (check) =>
      check.status === "failed" ||
      check.status === "error"
  );
}

function hasInconclusiveRegression(
  checks: CheckResult[]
): boolean {
  return checks.some(
    (check) =>
      check.status === "blocked"
  );
}

export async function verifyDependencySecurityFix(
  repositoryPath: string,
  before: CheckResult,
  regressionChecks: CheckResult[] = []
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
    return {
      status: "not_proven",
      summary:
        "The dependency security finding remains after the remediation attempt.",
      comparisons: [
        comparison,
      ],
      regressionChecks,
    };
  }

  if (
    hasRegression(
      regressionChecks
    )
  ) {
    return {
      status: "not_proven",
      summary:
        "The security finding was removed, but regression checks reported a failure.",
      comparisons: [
        comparison,
      ],
      regressionChecks,
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
        "The security finding was removed, but one or more regression checks were blocked.",
      comparisons: [
        comparison,
      ],
      regressionChecks,
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