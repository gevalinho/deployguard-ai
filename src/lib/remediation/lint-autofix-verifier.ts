import type {
  CheckResult,
} from "@/lib/checks/types";

import {
  runSandboxLintAgent,
} from "@/lib/agents/sandbox-lint-agent";

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

export async function verifyLintAutofix(
  repositoryPath: string,
  before: CheckResult,
  regressionChecks: CheckResult[] = []
): Promise<FixProof> {
  /*
   * Re-run the normal deterministic lint agent.
   *
   * The fixer does not get to declare its own
   * success. DeployGuard independently verifies
   * the repository after mutation.
   */
  const after =
    await runSandboxLintAgent(
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

  /*
   * If lint itself cannot produce a trustworthy
   * result, remediation cannot be proven.
   */
  if (
    after.status === "blocked" ||
    after.status === "error"
  ) {
    return {
      status: "inconclusive",

      summary:
        "DeployGuard could not obtain sufficient lint evidence to prove the remediation.",

      comparisons: [
        comparison,
      ],

      regressionChecks,
    };
  }

  /*
   * ESLint may successfully execute --fix while
   * leaving non-fixable violations behind.
   *
   * Execution success is therefore not proof.
   */
  if (after.status !== "passed") {
    return {
      status: "not_proven",

      summary:
        "Lint violations remain after the controlled autofix attempt.",

      comparisons: [
        comparison,
      ],

      regressionChecks,
    };
  }

  /*
   * The lint failure disappeared, but another
   * deterministic application check regressed.
   */
  if (
    hasRegression(
      regressionChecks
    )
  ) {
    return {
      status: "not_proven",

      summary:
        "The original lint failure was removed, but regression checks reported a failure.",

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
        "The original lint failure was removed, but one or more regression checks were blocked.",

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
        ? "The original lint failure was removed and the supplied regression checks remained acceptable."
        : "The original lint failure was removed and no supplied regression check reported a failure.",

    comparisons: [
      comparison,
    ],

    regressionChecks,
  };
}