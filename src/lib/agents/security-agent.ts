import type {
  CheckResult,
} from "@/lib/checks/types";

import {
  runCommand,
} from "@/lib/execution/command-runner";

import type {
  RepositoryScanResult,
} from "@/lib/scanner/types";

const SECURITY_AUDIT_TIMEOUT_MS =
  30_000;

type NpmAuditSeverity =
  | "info"
  | "low"
  | "moderate"
  | "high"
  | "critical";

type NpmAuditVulnerability = {
  name?: string;
  severity?: NpmAuditSeverity;
  isDirect?: boolean;
  range?: string;
  fixAvailable?:
    | boolean
    | {
        name?: string;
        version?: string;
        isSemVerMajor?: boolean;
      };
};

type NpmAuditReport = {
  vulnerabilities?: Record<
    string,
    NpmAuditVulnerability
  >;

  metadata?: {
    vulnerabilities?: {
      info?: number;
      low?: number;
      moderate?: number;
      high?: number;
      critical?: number;
      total?: number;
    };
  };
};

function getPackageManager(
  scan: RepositoryScanResult
): string | null {
  return (
    scan.facts.find(
      (fact) =>
        fact.key ===
        "packageManager"
    )?.value ?? null
  );
}

function isAuditExecutionError(
  stdout: string,
  stderr: string
): boolean {
  const output =
    `${stdout}\n${stderr}`.toLowerCase();

  return (
    output.includes(
      "audit endpoint returned an error"
    ) ||
    output.includes(
      "eai_again"
    ) ||
    output.includes(
      "enotfound"
    ) ||
    output.includes(
      "econnrefused"
    ) ||
    output.includes(
      "etimedout"
    ) ||
    output.includes(
      "network request"
    ) ||
    output.includes(
      "network error"
    ) ||
    output.includes(
      "socket hang up"
    )
  );
}

function parseNpmAuditReport(
  stdout: string
): NpmAuditReport | null {
  if (!stdout.trim()) {
    return null;
  }

  try {
    return JSON.parse(
      stdout
    ) as NpmAuditReport;
  } catch {
    return null;
  }
}

function getSeverityCount(
  report: NpmAuditReport,
  severity: NpmAuditSeverity
): number {
  return (
    report.metadata
      ?.vulnerabilities?.[
      severity
    ] ?? 0
  );
}

function getHighRiskPackages(
  report: NpmAuditReport
): string[] {
  if (!report.vulnerabilities) {
    return [];
  }

  return Object.entries(
    report.vulnerabilities
  )
    .filter(
      ([, vulnerability]) =>
        vulnerability.severity ===
          "high" ||
        vulnerability.severity ===
          "critical"
    )
    .map(
      ([
        packageName,
        vulnerability,
      ]) =>
        vulnerability.name ??
        packageName
    )
    .filter(
      (
        packageName,
        index,
        packages
      ) =>
        packages.indexOf(
          packageName
        ) === index
    );
}

function createSecuritySummary(
  report: NpmAuditReport
): string {
  const high =
    getSeverityCount(
      report,
      "high"
    );

  const critical =
    getSeverityCount(
      report,
      "critical"
    );

  const totalHighRisk =
    high + critical;

  if (totalHighRisk === 0) {
    return (
      "No high or critical " +
      "dependency vulnerabilities " +
      "were detected."
    );
  }

  const packages =
    getHighRiskPackages(
      report
    );

  const severityParts: string[] =
    [];

  if (critical > 0) {
    severityParts.push(
      `${critical} critical`
    );
  }

  if (high > 0) {
    severityParts.push(
      `${high} high`
    );
  }

  const packageSummary =
    packages.length > 0
      ? ` Affected packages include ${packages
          .slice(0, 5)
          .join(", ")}${
          packages.length > 5
            ? ` and ${
                packages.length -
                5
              } more`
            : ""
        }.`
      : "";

  return (
    `${severityParts.join(
      " and "
    )} severity dependency ` +
    `vulnerabilit${
      totalHighRisk === 1
        ? "y was"
        : "ies were"
    } detected.` +
    packageSummary
  );
}

export async function runSecurityAgent(
  scan: RepositoryScanResult
): Promise<CheckResult> {
  const packageManager =
    getPackageManager(scan);

  if (!packageManager) {
    return {
      id: "dependency-security",
      category: "security",
      name:
        "Dependency Security Audit",
      status: "skipped",
      skipReason:
        "not_configured",
      summary:
        "No verified package manager was detected.",
    };
  }

  if (packageManager !== "npm") {
    return {
      id: "dependency-security",
      category: "security",
      name:
        "Dependency Security Audit",
      status: "skipped",
      skipReason:
        "unsupported",
      summary:
        `Security audit is not yet implemented for ${packageManager}.`,
    };
  }

  const command =
    "npm audit --audit-level=high --json";

  const result =
    await runCommand(
      "npm",
      [
        "audit",
        "--audit-level=high",
        "--json",
      ],
      scan.repositoryPath,
      {
        timeoutMs:
          SECURITY_AUDIT_TIMEOUT_MS,
      }
    );

  if (result.timedOut) {
    return {
      id: "dependency-security",
      category: "security",
      name:
        "Dependency Security Audit",
      status: "blocked",
      command,
      exitCode:
        result.exitCode,
      durationMs:
        result.durationMs,
      summary:
        "Dependency security verification was blocked because the npm audit service did not respond within 30 seconds.",
      stdout:
        result.stdout,
      stderr:
        result.stderr,
    };
  }

  if (
    isAuditExecutionError(
      result.stdout,
      result.stderr
    )
  ) {
    return {
      id: "dependency-security",
      category: "security",
      name:
        "Dependency Security Audit",
      status: "blocked",
      command,
      exitCode:
        result.exitCode,
      durationMs:
        result.durationMs,
      summary:
        "Dependency security verification was blocked because the npm registry or audit service was unavailable.",
      stdout:
        result.stdout,
      stderr:
        result.stderr,
    };
  }

  const auditReport =
    parseNpmAuditReport(
      result.stdout
    );

  if (!auditReport) {
    return {
      id: "dependency-security",
      category: "security",
      name:
        "Dependency Security Audit",
      status: "error",
      command,
      exitCode:
        result.exitCode,
      durationMs:
        result.durationMs,
      summary:
        "The dependency security audit completed, but DeployGuard could not parse the npm audit report.",
      stdout:
        result.stdout,
      stderr:
        result.stderr,
    };
  }

  const high =
    getSeverityCount(
      auditReport,
      "high"
    );

  const critical =
    getSeverityCount(
      auditReport,
      "critical"
    );

  const hasHighRiskVulnerabilities =
    high > 0 || critical > 0;

  return {
    id: "dependency-security",
    category: "security",
    name:
      "Dependency Security Audit",
    status:
      hasHighRiskVulnerabilities
        ? "failed"
        : "passed",
    command,
    exitCode:
      result.exitCode,
    durationMs:
      result.durationMs,
    summary:
      createSecuritySummary(
        auditReport
      ),
    stdout:
      result.stdout,
    stderr:
      result.stderr,
  };
}