import { cpSync, mkdtempSync, rmSync } from "node:fs";

// import {
//   tmpdir,
// } from "node:os";

import { join, resolve } from "node:path";

import { runSandboxSecurityAgent } from "@/lib/agents/sandbox-security-agent";

import { applyDependencySecurityFix } from "@/lib/remediation/dependency-security-fixer";

import { verifyDependencySecurityFix } from "@/lib/remediation/dependency-security-verifier";

import type { FixProposal } from "@/lib/remediation/types";

import { runSandboxTestAgent } from "@/lib/agents/sandbox-test-agent";

import { parseNpmStyleAuditReport } from "@/lib/agents/sandbox-security-agent";

import { SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";

async function main() {
  const fixturePath = resolve(
    process.cwd(),
    ".deployguard",
    "cache",
    "repositories",
    "gevalinho--deployguard-vulnerable-fixture",
    "repository",
  );

  const temporaryRoot = mkdtempSync(
    join(process.cwd(), ".deployguard", "workspaces", "remediation-test-"),
  );

  const repositoryPath = join(temporaryRoot, "repository");
  let preserveWorkspace = false;

  try {
    cpSync(fixturePath, repositoryPath, {
      recursive: true,
    });

    console.log("\n=== DeployGuard Remediation Proof Test ===\n");

    console.log("1. Detecting original security state...");

    const before = await runSandboxSecurityAgent(repositoryPath);

    console.log(`Before: ${before.status}`);

    console.log(before.summary);

    if (before.status !== "failed") {
      throw new Error(
        "Expected the vulnerable fixture to fail the security check.",
      );
    }

    console.log("\nCaptured evidence:");

    for (const evidence of before.evidence ?? []) {
      console.log(`- ${evidence.message}`);
    }

    const findings = parseNpmStyleAuditReport(before.stdout ?? "");

    const lodashFindings = findings?.filter(
      (finding) => finding.packageName.toLowerCase() === "lodash",
    );

    if (!lodashFindings || lodashFindings.length !== 1) {
      throw new Error(
        "Expected exactly one lodash finding in the baseline audit.",
      );
    }

    const advisoryIds = lodashFindings[0].advisoryIds ?? [];

    const validAdvisoryIds = [
      ...new Set(advisoryIds.filter((id) => /^[0-9]{1,20}$/.test(id))),
    ].sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
    );

    if (
      validAdvisoryIds.length === 0 ||
      validAdvisoryIds.length !== advisoryIds.length
    ) {
      throw new Error("Expected valid, unique numeric lodash advisory IDs.");
    }

    const advisoryId = validAdvisoryIds[0];

    console.log(`Found ${validAdvisoryIds.length} lodash advisories.`);

    console.log(`Target advisory: ${advisoryId}`);

    const proposal: FixProposal = {
      id: "dependency-security-test",

      title: "Remediate dependency security finding",

      description:
        "Apply the controlled npm dependency security remediation strategy.",

      strategy: "dependency_security",

      risk: "breaking_change_allowed",

      target: {
        checkId: before.id,

        category: before.category,

        evidenceIndexes: (before.evidence ?? []).map((_, index) => index),
      },

      packageName: "lodash",

      advisoryId,
    };

    console.log("\n2. Applying controlled remediation...");

    if (!before.stdout?.trim()) {
      throw new Error(
        "Baseline npm audit output is missing. Remediation is not authorized.",
      );
    }

    const execution = await applyDependencySecurityFix(
      repositoryPath,
      proposal,
      before.stdout,
    );

    console.log(`Fix execution: ${execution.status}`);

    console.log(execution.summary);

    if (execution.status !== "applied") {
      throw new Error("Dependency remediation was not applied.");
    }

    console.log("\n3. Running regression tests...");

    const testRegression = await runSandboxTestAgent(repositoryPath);

    console.log(`Tests: ${testRegression.status}`);

    console.log(testRegression.summary);

    console.log("\n4. Re-verifying security evidence...");

    const proof = await verifyDependencySecurityFix(
      repositoryPath,
      before,
      [testRegression],
      "lodash",
      [testRegression.id],
      advisoryId,
    );

    const after = proof.comparisons[0]?.after;

    console.log(`After: ${after?.status ?? "unknown"}`);

    if (after) {
      console.log(after.summary);
    }

    console.log("\n5. Proof result:");

    console.log(proof.status.toUpperCase());

    console.log(proof.summary);

    if (proof.status !== "proven") {
      throw new Error("DeployGuard could not prove the remediation.");
    }

    console.log("\n✓ Detect → Fix → Re-verify → Prove succeeded.\n");
  } catch (error) {
    if (error instanceof SandboxContainerStateUnknownError) {
      preserveWorkspace = true;

      console.error(
        "Docker container state is unknown. " +
          "Temporary workspace retained for safety.",
      );

      console.error(`Retained workspace: ${temporaryRoot}`);
    }

    throw error;
  } finally {
    if (!preserveWorkspace) {
      rmSync(temporaryRoot, {
        recursive: true,
        force: true,
      });

      console.log("Temporary remediation workspace cleaned up.");
    }
  }
}

main().catch((error) => {
  console.error("\nRemediation proof test failed:");

  console.error(error instanceof Error ? error.message : error);

  process.exitCode = 1;
});
