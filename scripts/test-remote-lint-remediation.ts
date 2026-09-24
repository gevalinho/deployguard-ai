import {
  runRemoteRemediation,
} from "@/lib/orchestration/remediation-orchestrator";

import type {
  FixProposal,
} from "@/lib/remediation/types";

const repositoryUrl =
  "https://github.com/gevalinho/deployguard-lint-fixture";

const proposal: FixProposal = {
  id: "lint-autofix-fixture",
  title: "Apply controlled ESLint autofix",
  description:
    "Apply ESLint autofix in a disposable workspace and independently verify the result.",

  target: {
    checkId: "lint",
    category: "lint",
    evidenceIndexes: [0, 1, 2],
  },

  strategy:
    "lint_autofix",

  risk:
    "safe",
};

async function main(): Promise<void> {
  console.log(
    "\n=== DeployGuard Remote Lint Remediation Test ===\n"
  );

  const result =
    await runRemoteRemediation(
      repositoryUrl,
      proposal
    );

  console.log(
    `Repository: ${result.repository.fullName}`
  );

  console.log(
    `Fix execution: ${result.remediation.execution.status}`
  );

  console.log(
    result.remediation.execution.summary
  );

  const proof =
    result.remediation.proof;

  if (!proof) {
    throw new Error(
      "Lint remediation completed without proof."
    );
  }

  console.log(
    `\nProof: ${proof.status.toUpperCase()}`
  );

  console.log(
    proof.summary
  );

  for (
    const comparison of
    proof.comparisons
  ) {
    console.log(
      [
        `Check ${comparison.checkId}:`,
        `${comparison.before.status}`,
        "→",
        `${comparison.after.status}`,
        comparison.improved
          ? "(improved)"
          : "(not improved)",
      ].join(" ")
    );
  }

  if (
    proof.regressionChecks.length > 0
  ) {
    console.log(
      "\nRegression checks:"
    );

    for (
      const check of
      proof.regressionChecks
    ) {
      console.log(
        `- ${check.name}: ${check.status}`
      );
    }
  }

  if (
    result.remediation.execution.status !==
    "applied"
  ) {
    throw new Error(
      "Expected controlled lint remediation to be applied."
    );
  }

  if (
    proof.status !== "proven"
  ) {
    throw new Error(
      `Expected PROVEN lint remediation, received ${proof.status}.`
    );
  }

  console.log(
    "\n✓ Remote lint Detect → Fix → Re-verify → Prove succeeded.\n"
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      "\nRemote lint remediation test failed:",
      error
    );

    process.exitCode = 1;
  }
);