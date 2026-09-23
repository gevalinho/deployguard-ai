import {
  runRemoteRemediation,
} from "@/lib/orchestration/remediation-orchestrator";

import type {
  FixProposal,
} from "@/lib/remediation/types";

const repositoryUrl =
  "https://github.com/gevalinho/deployguard-vulnerable-fixture";

const proposal: FixProposal = {
  id: "dependency-security-lodash",
  title: "Remediate lodash vulnerability",
  description:
    "Apply the controlled dependency security remediation and independently verify the result.",

  target: {
    checkId: "security",
    category: "security",
    evidenceIndexes: [0],
  },

  strategy:
    "dependency_security",

  /*
   * Our fixture intentionally requires npm's
   * breaking-change remediation path.
   */
  risk:
    "breaking_change_allowed",

  packageName: "lodash",
};

async function main(): Promise<void> {
  console.log(
    "\n=== DeployGuard Remote Remediation Test ===\n"
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
      "Remediation completed without proof."
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
    proof.regressionChecks.length >
    0
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
      "Expected the controlled remediation to be applied."
    );
  }

  if (
    proof.status !== "proven"
  ) {
    throw new Error(
      `Expected PROVEN remediation, received ${proof.status}.`
    );
  }

  console.log(
    "\n✓ Remote Detect → Fix → Re-verify → Prove succeeded.\n"
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      "\nRemote remediation test failed:",
      error
    );

    process.exitCode = 1;
  }
);