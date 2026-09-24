import {
  readFileSync,
  writeFileSync,
} from "node:fs";

import {
  resolve,
} from "node:path";

import {
  runSandboxLintAgent,
} from "@/lib/agents/sandbox-lint-agent";

import {
  applyLintAutofix,
} from "@/lib/remediation/lint-autofix-fixer";

import {
  verifyLintAutofix,
} from "@/lib/remediation/lint-autofix-verifier";

import type {
  FixProposal,
} from "@/lib/remediation/types";

const fixturePath =
  resolve(
    process.cwd(),
    "../fixtures/lint-autofix"
  );

const examplePath =
  resolve(
    fixturePath,
    "example.js"
  );

const brokenSource =
  [
    "const message = 'DeployGuard lint remediation works'",
    "console.log(message)",
    "",
  ].join("\n");

async function main() {
  console.log(
    "\n=== DeployGuard Lint Remediation Proof Test ===\n"
  );

  /*
   * Always begin from the deliberately broken
   * repository state.
   */
  writeFileSync(
    examplePath,
    brokenSource,
    "utf8"
  );

  console.log(
    "1. Detecting original lint state..."
  );

  const before =
    await runSandboxLintAgent(
      fixturePath
    );

  console.log(
    `Before: ${before.status}`
  );

  console.log(
    before.summary
  );

  if (
    before.status !== "failed"
  ) {
    throw new Error(
      "The lint fixture did not reproduce the expected failure."
    );
  }

  if (
    !before.evidence ||
    before.evidence.length === 0
  ) {
    throw new Error(
      "DeployGuard did not capture structured lint evidence."
    );
  }

  console.log(
    "\nCaptured evidence:"
  );

  for (
    const evidence of
    before.evidence
  ) {
    const location =
      evidence.file
        ? `${evidence.file}${
            evidence.line
              ? `:${evidence.line}`
              : ""
          }`
        : "unknown location";

    console.log(
      `- ${location}: ${evidence.message}${
        evidence.code
          ? ` (${evidence.code})`
          : ""
      }`
    );
  }

  const proposal: FixProposal = {
    id:
      "lint-autofix-fixture",

    title:
      "Apply controlled ESLint autofix",

    description:
      "Apply ESLint autofix and independently verify the result.",

    target: {
      checkId:
        "lint",

      category:
        "lint",

      evidenceIndexes:
        before.evidence.map(
          (_, index) =>
            index
        ),
    },

    strategy:
      "lint_autofix",

    risk:
      "safe",
  };

  console.log(
    "\n2. Applying controlled lint remediation..."
  );

  const execution =
    await applyLintAutofix(
      fixturePath,
      proposal
    );

  console.log(
    `Fix execution: ${execution.status}`
  );

  console.log(
    execution.summary
  );

  if (
    execution.status !== "applied"
  ) {
    throw new Error(
      "Lint remediation was not applied."
    );
  }

  /*
   * For this isolated proof fixture there are no
   * additional application regression checks yet.
   *
   * The verifier independently reruns lint.
   */
  console.log(
    "\n3. Re-verifying lint evidence..."
  );

  const proof =
    await verifyLintAutofix(
      fixturePath,
      before
    );

  const comparison =
    proof.comparisons[0];

  console.log(
    `After: ${comparison.after.status}`
  );

  console.log(
    comparison.after.summary
  );

  console.log(
    "\n4. Proof result:"
  );

  console.log(
    proof.status.toUpperCase()
  );

  console.log(
    proof.summary
  );

  if (
    proof.status !== "proven"
  ) {
    throw new Error(
      "Lint remediation could not be proven."
    );
  }

  const fixedSource =
    readFileSync(
      examplePath,
      "utf8"
    );

  console.log(
    "\nRemediated source:"
  );

  console.log(
    fixedSource.trim()
  );

  console.log(
    "\n✓ Detect → Fix → Re-verify → Prove succeeded."
  );
}

main()
  .catch((error) => {
    console.error(
      "\nLint remediation proof test failed:",
      error instanceof Error
        ? error.message
        : error
    );

    process.exitCode = 1;
  })
  .finally(() => {
    /*
     * Restore the fixture so every run starts
     * from the same known failure.
     */
    writeFileSync(
      examplePath,
      brokenSource,
      "utf8"
    );

    console.log(
      "\nLint fixture restored."
    );
  });