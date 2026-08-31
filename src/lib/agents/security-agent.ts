import type { CheckResult } from "@/lib/checks/types";
import { runCommand } from "@/lib/execution/command-runner";
import type { RepositoryScanResult } from "@/lib/scanner/types";

function getPackageManager(
  scan: RepositoryScanResult
): string | null {
  return (
    scan.facts.find(
      (fact) => fact.key === "packageManager"
    )?.value ?? null
  );
}

function isAuditExecutionError(
  stdout: string,
  stderr: string
): boolean {
  const output = `${stdout}\n${stderr}`.toLowerCase();

  return (
    output.includes("audit endpoint returned an error") ||
    output.includes("eai_again") ||
    output.includes("enotfound") ||
    output.includes("econnrefused") ||
    output.includes("etimedout")
  );
}

export async function runSecurityAgent(
  scan: RepositoryScanResult
): Promise<CheckResult> {
  const packageManager = getPackageManager(scan);

  if (!packageManager) {
    return {
      id: "dependency-security",
      category: "security",
      name: "Dependency Security Audit",
      status: "skipped",
      summary: "No verified package manager was detected.",
    };
  }

  if (packageManager !== "npm") {
    return {
      id: "dependency-security",
      category: "security",
      name: "Dependency Security Audit",
      status: "skipped",
      summary: `Security audit is not yet implemented for ${packageManager}.`,
    };
  }

  const result = await runCommand(
    "npm",
    ["audit", "--audit-level=high"],
    scan.repositoryPath
  );

  if (isAuditExecutionError(result.stdout, result.stderr)) {
    return {
      id: "dependency-security",
      category: "security",
      name: "Dependency Security Audit",
      status: "error",
      command: "npm audit --audit-level=high",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      summary:
        "Dependency security audit could not be completed because the npm registry was unavailable.",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    id: "dependency-security",
    category: "security",
    name: "Dependency Security Audit",
    status: result.status,
    command: "npm audit --audit-level=high",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary:
      result.status === "passed"
        ? "No high-severity dependency vulnerabilities were detected."
        : "High-severity dependency vulnerabilities were detected.",
    stdout: result.stdout,
    stderr: result.stderr,
  };
}