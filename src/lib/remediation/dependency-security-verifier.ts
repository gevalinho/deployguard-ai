import type {
  CheckResult,
} from "@/lib/checks/types";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hasDirectNodeApiRuntime, isDependencyOnlyNpmPackage } from "@/lib/capabilities/build-applicability";
import { scanRepository } from "@/lib/scanner/repository-scanner";

import {
  runSandboxSecurityAgent,
  parseNpmStyleAuditReport,
} from "@/lib/agents/sandbox-security-agent";

import type {
  FixProof,
} from "@/lib/remediation/types";

const REQUIRED_REGRESSION_IDS = ["types", "lint", "test", "build"] as const;

function hasCompleteRegressionSet(checks: CheckResult[]): boolean {
  return checks.length === REQUIRED_REGRESSION_IDS.length &&
    REQUIRED_REGRESSION_IDS.every((id) =>
      checks.filter((check) => check.id === id && check.category === id).length === 1);
}

function hasRegression(
  checks: CheckResult[]
): boolean {
  return checks.some(
    (check) =>
      check.status === "failed"
  );
}

function hasTypeScriptSource(root: string): boolean {
  const pending = [root];
  let inspected = 0;
  while (pending.length) {
    if (++inspected > 10_000) return true;
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) return true;
      if (entry.isDirectory() && !["node_modules", ".git", ".next"].includes(entry.name))
        pending.push(join(directory, entry.name));
      if (entry.isFile() && /\.(?:ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
        return true;
    }
  }
  return false;
}

function repositoryCapabilities(repositoryPath: string): { nonApplicable: Set<string>; configuredTests: boolean } {
  const result = { nonApplicable: new Set<string>(), configuredTests: false };
  try {
    const packageJson = JSON.parse(readFileSync(join(repositoryPath, "package.json"), "utf8"));
    if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson) ||
        !packageJson.scripts || typeof packageJson.scripts !== "object" ||
        !existsSync(join(repositoryPath, "package-lock.json"))) return result;
    const scripts = packageJson.scripts as Record<string, unknown>;
    result.configuredTests = typeof scripts.test === "string" && scripts.test.trim().length > 0;
    const facts = scanRepository(repositoryPath).facts;
    const tooling = { ...packageJson.dependencies, ...packageJson.devDependencies };
    if (!existsSync(join(repositoryPath, "tsconfig.json")) && !tooling.typescript &&
        !hasTypeScriptSource(repositoryPath) &&
        !facts.some((fact) => fact.key === "language" && fact.value === "TypeScript") &&
        !scripts.typecheck) result.nonApplicable.add("types");
    const lintTools = ["eslint", "prettier", "biome", "@biomejs/biome", "standard", "jshint"];
    const lintConfigs = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs",
      ".eslintrc", ".eslintrc.js", ".eslintrc.json", "biome.json", "biome.jsonc"];
    if (!scripts.lint && !lintTools.some((tool) => tooling[tool]) &&
        !lintConfigs.some((file) => existsSync(join(repositoryPath, file))) &&
        !packageJson.eslintConfig) result.nonApplicable.add("lint");
    if (!scripts.build && !packageJson.workspaces &&
        (hasDirectNodeApiRuntime(repositoryPath, scripts as Record<string, string>, facts) ||
          isDependencyOnlyNpmPackage(repositoryPath))) result.nonApplicable.add("build");
  } catch {
    // Missing, malformed, or unreadable capability evidence proves nothing.
  }
  return result;
}

export async function verifyDependencySecurityFix(
  repositoryPath: string,
  before: CheckResult,
  regressionChecks: CheckResult[] = [],
  targetPackageName?: string,
  _requiredCheckIds: string[] = [],
  targetAdvisoryId?: string,
): Promise<FixProof> {
  // Preserve the legacy call shape; required identities are fixed by this verifier.
  void _requiredCheckIds;
  const after =
    await runSandboxSecurityAgent(
      repositoryPath
    );
  const capabilities = repositoryCapabilities(repositoryPath);

  const comparison = {
    checkId: before.id,
    before,
    after,
    improved:
      before.status === "failed" &&
      after.status === "passed",
  };

  const beforeFindings = parseNpmStyleAuditReport(before.stdout ?? "");
  const afterFindings = parseNpmStyleAuditReport(after.stdout ?? "");
  const counts = afterFindings && {
    info: afterFindings.filter((finding) => finding.severity === "info").length,
    low: afterFindings.filter((finding) => finding.severity === "low").length,
    moderate: afterFindings.filter((finding) => finding.severity === "moderate").length,
    high: afterFindings.filter((finding) => finding.severity === "high").length,
    critical: afterFindings.filter((finding) => finding.severity === "critical").length,
  };
  const targetMatches = (findings: NonNullable<typeof beforeFindings>) => findings.filter(
    (finding) => finding.packageName.toLowerCase() === targetPackageName?.toLowerCase() &&
      finding.advisoryIds?.includes(targetAdvisoryId ?? ""),
  );
  const beforeMatches = beforeFindings ? targetMatches(beforeFindings) : [];
  const afterMatches = afterFindings ? targetMatches(afterFindings) : [];
  let status: FixProof["status"] = "inconclusive";
  let summary = "A complete before and after npm audit report is required to prove remediation.";
  const trustworthy = before.status === "failed" && before.exitCode !== null &&
    before.exitCode !== undefined && before.exitCode !== 0 &&
    ["passed", "failed"].includes(after.status) &&
    after.exitCode !== null && after.exitCode !== undefined &&
    ((after.status === "passed" && after.exitCode === 0) ||
      (after.status === "failed" && after.exitCode !== 0));
  const statusConsistent = !!afterFindings &&
    (after.status === "failed" ? afterFindings.some((finding) =>
      finding.severity === "high" || finding.severity === "critical") :
      !afterFindings.some((finding) => finding.severity === "high" || finding.severity === "critical"));
  if (beforeFindings && afterFindings && trustworthy && statusConsistent && targetPackageName &&
      targetAdvisoryId && /^[0-9]{1,20}$/.test(targetAdvisoryId)) {
    if (beforeMatches.length !== 1 || beforeFindings.some((finding) =>
      finding.packageName.toLowerCase() !== targetPackageName.toLowerCase() &&
      finding.advisoryIds?.includes(targetAdvisoryId))) {
      summary = "The targeted advisory identity was absent or ambiguous in the baseline audit.";
    } else if (afterMatches.length > 0 || afterFindings.some((finding) =>
      finding.packageName.toLowerCase() !== targetPackageName.toLowerCase() &&
      finding.advisoryIds?.includes(targetAdvisoryId))) {
      status = "not_proven";
      summary = "The targeted advisory remains in the post-remediation audit.";
    } else if (!hasCompleteRegressionSet(regressionChecks) ||
      !capabilities.configuredTests ||
      regressionChecks.some((check) => check.status === "blocked" || check.status === "error" ||
        (check.status === "skipped" && !(check.id !== "test" && capabilities.nonApplicable.has(check.id) &&
          (check.skipReason === "not_applicable" ||
            (check.id === "lint" && check.skipReason === "not_configured"))))) ||
      regressionChecks.some((check) => check.status === "passed" &&
        (check.exitCode !== 0 || check.skipReason !== undefined)) ||
      regressionChecks.some((check) => check.id === "test" &&
        check.status === "passed" && (check.exitCode !== 0 || check.testExecutionVerified !== true))) {
      summary = "Required regression evidence was unavailable or incomplete.";
    } else if (hasRegression(regressionChecks)) {
      status = "not_proven";
      summary = "The targeted advisory was removed, but regression checks failed.";
    } else {
      status = "proven";
      summary = `The targeted advisory was absent after remediation. Other audit findings remain: ${afterFindings.length} total, ${counts!.high} high, ${counts!.critical} critical.`;
    }
  }
  console.error("[DeployGuard Remediation Verification]", {
    targetPackage: /^[a-zA-Z0-9@/._-]{1,214}$/.test(targetPackageName ?? "") ? targetPackageName : "invalid",
    targetAdvisoryId: /^[0-9]{1,20}$/.test(targetAdvisoryId ?? "") ? targetAdvisoryId : "invalid",
    baselineAuditValid: !!beforeFindings && before.status === "failed",
    postRemediationAuditValid: !!afterFindings && trustworthy && statusConsistent,
    targetVerificationResult: status,
    remainingVulnerabilities: counts,
    overallRemediationApprovalStatus: status === "proven" ? "pending_patch_checks" : "rejected",
  });
  return { status, summary, comparisons: [comparison], regressionChecks,
    ...(counts ? { remainingVulnerabilities: counts } : {}) };
}
