import type {
  CheckResult,
} from "@/lib/checks/types";

import {
  runDockerSandboxCommand,
} from "@/lib/sandbox/docker-sandbox";

import {
  detectPackageManager,
  type PackageManagerInfo,
} from "@/lib/sandbox/package-manager";

import {
  createAuditCommand,
} from "@/lib/sandbox/package-manager-command";

import {
  getCorepackSandboxConfig,
} from "@/lib/sandbox/corepack-cache";

const SECURITY_AUDIT_TIMEOUT_MS =
  30_000;

type AuditSeverity =
  | "info"
  | "low"
  | "moderate"
  | "high"
  | "critical";

interface AuditFinding {
  packageName: string;
  severity: AuditSeverity;
}

interface NpmStyleAuditReport {
  vulnerabilities?: Record<
    string,
    {
      name?: string;
      severity?: AuditSeverity;
    }
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
}

function looksLikeInfrastructureFailure(
  stdout: string,
  stderr: string
): boolean {
  const combinedOutput =
    `${stdout}\n${stderr}`;

  return /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|network|registry|socket hang up|fetch failed/i.test(
    combinedOutput
  );
}

function yarnClassicHasHighSeverityFinding(
  exitCode: number | null | undefined
): boolean {
  if (
    exitCode === null ||
    exitCode === undefined
  ) {
    return false;
  }

  const high = 8;
  const critical = 16;

  return (
    (exitCode & high) !== 0 ||
    (exitCode & critical) !== 0
  );
}

function auditReportedHighSeverityFinding(
  packageManager: PackageManagerInfo,
  exitCode: number | null | undefined
): boolean {
  if (
    packageManager.name === "yarn" &&
    packageManager.yarnMode === "classic"
  ) {
    return yarnClassicHasHighSeverityFinding(
      exitCode
    );
  }

  return (
    exitCode !== null &&
    exitCode !== undefined &&
    exitCode !== 0
  );
}

function parseJson(
  value: string
): unknown | null {
  if (!value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isAuditSeverity(
  value: unknown
): value is AuditSeverity {
  return (
    value === "info" ||
    value === "low" ||
    value === "moderate" ||
    value === "high" ||
    value === "critical"
  );
}

function extractNpmStyleFindings(
  stdout: string
): AuditFinding[] {
  const parsed =
    parseJson(stdout);

  if (
    !parsed ||
    typeof parsed !== "object"
  ) {
    return [];
  }

  const report =
    parsed as NpmStyleAuditReport;

  if (!report.vulnerabilities) {
    return [];
  }

  return Object.entries(
    report.vulnerabilities
  )
    .map(
      ([
        packageKey,
        vulnerability,
      ]) => {
        if (
          !isAuditSeverity(
            vulnerability.severity
          )
        ) {
          return null;
        }

        return {
          packageName:
            vulnerability.name ??
            packageKey,
          severity:
            vulnerability.severity,
        };
      }
    )
    .filter(
      (
        finding
      ): finding is AuditFinding =>
        finding !== null
    );
}

function extractYarnClassicFindings(
  stdout: string
): AuditFinding[] {
  const findings: AuditFinding[] =
    [];

  for (
    const line of stdout.split("\n")
  ) {
    if (!line.trim()) {
      continue;
    }

    const parsed =
      parseJson(line);

    if (
      !parsed ||
      typeof parsed !== "object"
    ) {
      continue;
    }

    const event = parsed as {
      type?: string;
      data?: {
        advisory?: {
          module_name?: string;
          severity?: string;
        };
      };
    };

    const advisory =
      event.data?.advisory;

    if (
      event.type !== "auditAdvisory" ||
      !advisory ||
      !isAuditSeverity(
        advisory.severity
      )
    ) {
      continue;
    }

    findings.push({
      packageName:
        advisory.module_name ??
        "unknown package",
      severity:
        advisory.severity,
    });
  }

  return findings;
}

function extractAuditFindings(
  packageManager: PackageManagerInfo,
  stdout: string
): AuditFinding[] {
  if (
    packageManager.name === "yarn" &&
    packageManager.yarnMode === "classic"
  ) {
    return extractYarnClassicFindings(
      stdout
    );
  }

  return extractNpmStyleFindings(
    stdout
  );
}

function getHighRiskFindings(
  findings: AuditFinding[]
): AuditFinding[] {
  return findings.filter(
    (finding) =>
      finding.severity ===
        "high" ||
      finding.severity ===
        "critical"
  );
}

function createFailureSummary(
  findings: AuditFinding[]
): string {
  const highRisk =
    getHighRiskFindings(
      findings
    );

  if (highRisk.length === 0) {
    return (
      "High-severity dependency vulnerabilities were reported, " +
      "but DeployGuard could not extract detailed package evidence " +
      "from the audit output."
    );
  }

  const criticalCount =
    highRisk.filter(
      (finding) =>
        finding.severity ===
        "critical"
    ).length;

  const highCount =
    highRisk.filter(
      (finding) =>
        finding.severity ===
        "high"
    ).length;

  const uniquePackages = [
    ...new Set(
      highRisk.map(
        (finding) =>
          finding.packageName
      )
    ),
  ];

  const severityParts: string[] =
    [];

  if (criticalCount > 0) {
    severityParts.push(
      `${criticalCount} critical`
    );
  }

  if (highCount > 0) {
    severityParts.push(
      `${highCount} high`
    );
  }

  const packagePreview =
    uniquePackages
      .slice(0, 5)
      .join(", ");

  const remaining =
    uniquePackages.length - 5;

  const packageText =
    packagePreview
      ? ` Affected packages include ${packagePreview}${
          remaining > 0
            ? ` and ${remaining} more`
            : ""
        }.`
      : "";

  return (
    `${severityParts.join(
      " and "
    )} severity dependency ` +
    `vulnerabilit${
      highRisk.length === 1
        ? "y was"
        : "ies were"
    } reported.` +
    packageText
  );
}

export async function runSandboxSecurityAgent(
  repositoryPath: string
): Promise<CheckResult> {
  const packageManager =
    detectPackageManager(
      repositoryPath
    );

  if (!packageManager) {
    return {
      id: "security",
      category: "security",
      name:
        "Dependency Security",
      status: "skipped",
      skipReason:
        "not_applicable",
      summary:
        "No supported package manager lockfile was detected.",
    };
  }

  const corepackConfig =
    getCorepackSandboxConfig(
      packageManager,
      true
    );

  const auditCommand =
    createAuditCommand(
      packageManager
    );

  const result =
    await runDockerSandboxCommand({
      repositoryPath,

      command:
        auditCommand.command,

      network:
        "bridge",

      environment: {
        CI: "true",

        HOME:
          "/tmp/deployguard-home",

        ...(packageManager.name ===
        "npm"
          ? {
              npm_config_cache:
                "/tmp/npm-cache",
            }
          : {}),
      },

      mounts: [
        ...corepackConfig.mounts,
      ],

      user:
        typeof process.getuid ===
          "function" &&
        typeof process.getgid ===
          "function"
          ? `${process.getuid()}:${process.getgid()}`
          : "1000:1000",

      limits: {
        memoryMb: 1024,
        cpus: 1,
        timeoutMs:
          SECURITY_AUDIT_TIMEOUT_MS,
      },
    });

  if (
    result.status ===
    "timed_out"
  ) {
    return {
      id: "security",
      category: "security",
      name:
        "Dependency Security",
      status: "blocked",

      command:
        auditCommand.display,

      exitCode:
        result.exitCode,

      durationMs:
        result.durationMs,

      summary:
        "Dependency security verification was blocked because the package registry did not respond within 30 seconds.",

      stdout:
        result.stdout,

      stderr:
        result.stderr,
    };
  }

  if (
    looksLikeInfrastructureFailure(
      result.stdout,
      result.stderr
    )
  ) {
    return {
      id: "security",
      category: "security",
      name:
        "Dependency Security",
      status: "blocked",

      command:
        auditCommand.display,

      exitCode:
        result.exitCode,

      durationMs:
        result.durationMs,

      summary:
        "Dependency security verification was blocked because the package registry or audit service was unavailable.",

      stdout:
        result.stdout,

      stderr:
        result.stderr,
    };
  }

  const highSeverityFinding =
    auditReportedHighSeverityFinding(
      packageManager,
      result.exitCode
    );

  const findings =
    extractAuditFindings(
      packageManager,
      result.stdout
    );

  if (highSeverityFinding) {
    return {
      id: "security",
      category: "security",
      name:
        "Dependency Security",
      status: "failed",

      command:
        auditCommand.display,

      exitCode:
        result.exitCode,

      durationMs:
        result.durationMs,

      summary:
        createFailureSummary(
          findings
        ),

      stdout:
        result.stdout,

      stderr:
        result.stderr,
    };
  }

  return {
    id: "security",
    category: "security",
    name:
      "Dependency Security",
    status: "passed",

    command:
      auditCommand.display,

    exitCode:
      result.exitCode,

    durationMs:
      result.durationMs,

    summary:
      packageManager.name ===
          "yarn" &&
        packageManager.yarnMode ===
          "classic" &&
        result.exitCode !== 0
        ? "No high-severity dependency vulnerabilities were reported; lower-severity findings may be present."
        : "No high-severity dependency vulnerabilities were reported.",

    stdout:
      result.stdout,

    stderr:
      result.stderr,
  };
}