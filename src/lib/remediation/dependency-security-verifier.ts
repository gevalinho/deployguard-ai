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
      check.status === "skipped"
  );
}

export async function verifyDependencySecurityFix(
  repositoryPath: string,
  before: CheckResult,
  regressionChecks: CheckResult[] = [],
  targetPackageName?: string,
  requiredCheckIds: string[] = [],
  targetAdvisoryId?: string,
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
    } else if (requiredCheckIds.some((id) =>
      regressionChecks.filter((check) => check.id === id).length !== 1) ||
      hasInconclusiveRegression(regressionChecks)) {
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
