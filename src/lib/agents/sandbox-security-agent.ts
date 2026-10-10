import type {
  CheckEvidence,
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

export interface AuditFinding {
  packageName: string;
  severity: AuditSeverity;
  advisoryIds?: string[];
}

interface NpmStyleAuditReport {
  vulnerabilities?: Record<
    string,
    {
      name?: string;
      severity?: AuditSeverity;
      via?: unknown[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type AuditDiagnosticReason = "missing_stdout" | "empty_stdout" | "invalid_json" |
  "unsupported_report_version" | "missing_required_top_level_fields" |
  "invalid_vulnerability_records" | "invalid_metadata_counts" |
  "inconsistent_advisory_identifiers" | "inconsistent_vulnerability_relationships" |
  "sandbox_execution_failure" | "audit_service_unavailable" |
  "audit_exit_without_high_severity";

type AuditFieldType = "missing" | "null" | "object" | "array" | "string" | "number" | "boolean";

function auditFieldType(value: unknown): AuditFieldType {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as AuditFieldType;
}

const auditCountKeys = ["info", "low", "moderate", "high", "critical", "total"] as const;

export function inspectNpmStyleAuditReport(stdout: string | undefined): {
  findings: AuditFinding[] | null;
  diagnostic: {
    reason: AuditDiagnosticReason | null;
    stdoutBytes: number;
    jsonParsed: boolean;
    auditReportVersion: number | "missing" | "invalid";
    fields: { vulnerabilities: AuditFieldType; metadata: AuditFieldType;
      metadataVulnerabilities: AuditFieldType };
    counts?: Record<(typeof auditCountKeys)[number], number>;
  };
} {
  let parsedJson: unknown;
  let jsonParsed = false;
  if (typeof stdout === "string" && stdout.trim()) {
    try {
      parsedJson = JSON.parse(stdout);
      jsonParsed = true;
    } catch {
      // A parse failure is recorded as a code; never log the input or parser exception.
    }
  }
  const root = isRecord(parsedJson) ? parsedJson : null;
  const metadata = isRecord(root?.metadata) ? root.metadata : null;
  const rawCounts = isRecord(metadata?.vulnerabilities) ? metadata.vulnerabilities : null;
  const countsValid = rawCounts !== null && auditCountKeys.every(
    (key) => Number.isSafeInteger(rawCounts[key]) && Number(rawCounts[key]) >= 0
  );
  const diagnostic = {
    reason: null as AuditDiagnosticReason | null,
    stdoutBytes: typeof stdout === "string" ? Buffer.byteLength(stdout, "utf8") : 0,
    jsonParsed,
    auditReportVersion: typeof root?.auditReportVersion === "number" &&
      Number.isSafeInteger(root.auditReportVersion)
      ? root.auditReportVersion : root?.auditReportVersion === undefined ? "missing" as const : "invalid" as const,
    fields: {
      vulnerabilities: auditFieldType(root?.vulnerabilities),
      metadata: auditFieldType(root?.metadata),
      metadataVulnerabilities: auditFieldType(metadata?.vulnerabilities),
    },
    ...(countsValid ? { counts: Object.fromEntries(auditCountKeys.map(
      (key) => [key, rawCounts[key]]
    )) as Record<(typeof auditCountKeys)[number], number> } : {}),
  };
  const reject = (reason: AuditDiagnosticReason) => {
    diagnostic.reason = reason;
    return { findings: null, diagnostic };
  };
  if (stdout === undefined) return reject("missing_stdout");
  if (!stdout.trim()) return reject("empty_stdout");
  if (!jsonParsed) return reject("invalid_json");
  if (!root) return reject("missing_required_top_level_fields");
  if (root.auditReportVersion === undefined) return reject("missing_required_top_level_fields");
  if (root.auditReportVersion !== 2) return reject("unsupported_report_version");
  if (!isRecord(root.vulnerabilities) || !metadata || !rawCounts)
    return reject("missing_required_top_level_fields");
  const vulnerabilities = root.vulnerabilities as Record<string, unknown>;
  const counts = rawCounts;
  if (!countsValid) return reject("invalid_metadata_counts");
  const findings: AuditFinding[] = [];
  const relations = new Map<string, { via: string[]; effects: string[]; direct: boolean }>();
  const sourceOwners = new Map<string, string>();
  const severityRank: Record<AuditSeverity, number> =
    { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
  for (const [key, raw] of Object.entries(vulnerabilities)) {
    if (!isRecord(raw) || raw.name !== key || !isAuditSeverity(raw.severity) ||
        typeof raw.isDirect !== "boolean" || typeof raw.range !== "string" || !raw.range ||
        !Array.isArray(raw.nodes) || raw.nodes.length === 0 ||
        raw.nodes.some((node) => typeof node !== "string" || !node) ||
        !Array.isArray(raw.effects) || raw.effects.some((effect) => typeof effect !== "string" || !effect) ||
        !(typeof raw.fixAvailable === "boolean" ||
          (isRecord(raw.fixAvailable) && typeof raw.fixAvailable.name === "string" &&
            typeof raw.fixAvailable.version === "string"))) return reject("invalid_vulnerability_records");
    if (!Array.isArray(raw.via) || raw.via.length === 0) return reject("invalid_vulnerability_records");
    const via = raw.via;
    if (via.some((item) => typeof item === "string" ? !item || item === key :
        (!isRecord(item) || item.name !== key || !isAuditSeverity(item.severity) ||
          severityRank[item.severity as AuditSeverity] > severityRank[raw.severity as AuditSeverity] ||
          !Number.isSafeInteger(item.source) || Number(item.source) < 0))) return reject("invalid_vulnerability_records");
    const advisoryIds = via.flatMap((item) => {
      if (!isRecord(item)) return [];
      return [String(item.source)];
    });
    if (new Set(advisoryIds).size !== advisoryIds.length ||
        new Set(raw.effects).size !== raw.effects.length ||
        new Set(via.filter((item): item is string => typeof item === "string")).size !==
          via.filter((item) => typeof item === "string").length) return reject("inconsistent_advisory_identifiers");
    for (const id of advisoryIds) {
      if (sourceOwners.has(id) && sourceOwners.get(id) !== key) return reject("inconsistent_advisory_identifiers");
      sourceOwners.set(id, key);
    }
    relations.set(key, { via: via.filter((item): item is string => typeof item === "string"),
      effects: raw.effects as string[], direct: advisoryIds.length > 0 });
    findings.push({ packageName: key,
      severity: raw.severity, ...(advisoryIds.length ? { advisoryIds } : {}) });
  }
  for (const [key, { via, effects }] of relations) {
    if (via.some((dependency) => !relations.get(dependency)?.effects.includes(key)) ||
        effects.some((dependent) => !relations.get(dependent)?.via.includes(key))) return reject("inconsistent_vulnerability_relationships");
    const finding = findings.find((item) => item.packageName === key)!;
    if (via.some((dependency) => severityRank[findings.find((item) =>
      item.packageName === dependency)!.severity] > severityRank[finding.severity])) return reject("inconsistent_vulnerability_relationships");
  }
  const reachable = new Set<string>();
  const visiting = new Set<string>();
  const reachesDirectAdvisory = (key: string): boolean => {
    if (reachable.has(key)) return true;
    if (visiting.has(key)) return false;
    visiting.add(key);
    const relation = relations.get(key)!;
    const dependenciesValid = relation.via.every(reachesDirectAdvisory);
    const valid = dependenciesValid && (relation.direct || relation.via.length > 0);
    visiting.delete(key);
    if (valid) reachable.add(key);
    return valid;
  };
  if ([...relations.keys()].some((key) => !reachesDirectAdvisory(key))) return reject("inconsistent_vulnerability_relationships");
  if (!["info", "low", "moderate", "high", "critical"].every((severity) =>
    findings.filter((finding) => finding.severity === severity).length === counts[severity]
  ) || findings.length !== counts.total) return reject("invalid_metadata_counts");
  return { findings, diagnostic };
}

export function parseNpmStyleAuditReport(stdout: string): AuditFinding[] | null {
  return inspectNpmStyleAuditReport(stdout).findings;
}

function logAuditDiagnostic(
  diagnostic: ReturnType<typeof inspectNpmStyleAuditReport>["diagnostic"],
  execution: { status: string; exitCode: number | null }
): void {
  // Server logs are operational only. Keep this object restricted to fixed codes,
  // primitive shape data, and validated counts; never include audit content.
  console.warn("[DeployGuard Dependency Audit Diagnostic]", {
    ...diagnostic,
    sandboxStatus: execution.status,
    exitCode: execution.exitCode,
  });
}

function parseLegacyAuditReport(stdout: string): AuditFinding[] | null {
  const parsed = parseJson(stdout);
  if (!isRecord(parsed) || !isRecord(parsed.advisories) ||
      !isRecord(parsed.metadata) || !isRecord(parsed.metadata.vulnerabilities)) return null;
  const counts = parsed.metadata.vulnerabilities;
  if (!["high", "critical"].every((key) =>
    Number.isSafeInteger(counts[key]) && Number(counts[key]) >= 0)) return null;
  const findings: AuditFinding[] = [];
  for (const [id, raw] of Object.entries(parsed.advisories)) {
    if (!isRecord(raw) || !isAuditSeverity(raw.severity) ||
        typeof raw.module_name !== "string") return null;
    findings.push({ packageName: raw.module_name, severity: raw.severity,
      ...(/^[0-9]{1,20}$/.test(id) ? { advisoryIds: [id] } : {}) });
  }
  if (findings.filter((finding) => finding.severity === "high").length !== counts.high ||
      findings.filter((finding) => finding.severity === "critical").length !== counts.critical) return null;
  return findings;
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

export function extractNpmStyleFindings(
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
          id?: number | string;
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
      ...(typeof advisory.id === "number" && Number.isSafeInteger(advisory.id) && advisory.id >= 0
        ? { advisoryIds: [String(advisory.id)] } : {}),
    });
  }

  return findings;
}

function parseYarnClassicAuditReport(stdout: string): AuditFinding[] | null {
  const lines = stdout.trim().split("\n");
  if (!stdout.trim()) return null;
  let summary: Record<string, unknown> | null = null;
  for (const line of lines) {
    const event = parseJson(line);
    if (!isRecord(event) || typeof event.type !== "string") return null;
    if (event.type === "auditSummary") {
      if (!isRecord(event.data) || !isRecord(event.data.vulnerabilities)) return null;
      summary = event.data.vulnerabilities;
    }
  }
  if (!summary || !["high", "critical"].every(
    (key) => Number.isSafeInteger(summary?.[key]) && Number(summary?.[key]) >= 0
  )) return null;
  const findings = extractYarnClassicFindings(stdout);
  if (findings.filter((finding) => finding.severity === "high").length !== summary.high ||
      findings.filter((finding) => finding.severity === "critical").length !== summary.critical) return null;
  return findings;
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

export function createSecurityEvidence(
  findings: AuditFinding[]
): CheckEvidence[] {
  const highRisk =
    getHighRiskFindings(findings);

  const seen = new Map<string, CheckEvidence>();

  const evidence:
    CheckEvidence[] = [];

  for (const finding of highRisk) {
    const identity =
      `${finding.packageName}:${finding.severity}`;

    if (seen.has(identity)) {
      const existing = seen.get(identity)!;
      existing.advisoryIds = [...new Set([...(existing.advisoryIds ?? []), ...(finding.advisoryIds ?? [])])];
      continue;
    }

    const item: CheckEvidence = {
      kind: "security_finding",
      message:
        `${finding.packageName} has a ${finding.severity}-severity dependency vulnerability.`,
      code: finding.severity,
      ...(finding.advisoryIds?.length ? { advisoryIds: [...finding.advisoryIds] } : {}),
    };
    seen.set(identity, item);
    evidence.push(item);
  }

  return evidence;
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
    }).catch((error: unknown) => {
      if (packageManager.name === "npm") {
        logAuditDiagnostic(
          { ...inspectNpmStyleAuditReport(undefined).diagnostic, reason: "sandbox_execution_failure" },
          { status: "threw", exitCode: null }
        );
      }
      throw error;
    });

  if (
    result.status ===
    "timed_out"
  ) {
    if (packageManager.name === "npm") {
      const diagnostic = inspectNpmStyleAuditReport(result.stdout).diagnostic;
      logAuditDiagnostic({ ...diagnostic, reason: "sandbox_execution_failure" }, result);
    }
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
    if (packageManager.name === "npm") {
      logAuditDiagnostic(
        { ...inspectNpmStyleAuditReport(result.stdout).diagnostic, reason: "audit_service_unavailable" },
        result
      );
    }
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

  const npmInspection = packageManager.name === "npm"
    ? inspectNpmStyleAuditReport(result.stdout)
    : null;
  const parsedFindings = packageManager.name === "yarn" && packageManager.yarnMode === "classic"
    ? parseYarnClassicAuditReport(result.stdout)
    : packageManager.name === "npm"
      ? npmInspection!.findings
      : parseNpmStyleAuditReport(result.stdout) ?? parseLegacyAuditReport(result.stdout);
  if (!parsedFindings && npmInspection) {
    logAuditDiagnostic(npmInspection.diagnostic, result);
  }
  if (!parsedFindings) return {
    id: "security", category: "security", name: "Dependency Security",
    status: "error", command: auditCommand.display, exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary: "Dependency audit output was missing, incomplete, or unsupported.",
    stdout: result.stdout, stderr: result.stderr,
  };

  if (result.exitCode === null || result.exitCode === undefined ||
      (result.status === "failed" && result.exitCode === 0)) {
    if (npmInspection) logAuditDiagnostic(
      { ...npmInspection.diagnostic, reason: "sandbox_execution_failure" }, result
    );
    return {
    id: "security", category: "security", name: "Dependency Security",
    status: "error", command: auditCommand.display, exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary: "Dependency audit execution did not return a usable exit status.",
    stdout: result.stdout, stderr: result.stderr,
  };
  }

  const highSeverityFinding =
    auditReportedHighSeverityFinding(
      packageManager,
      result.exitCode
    );

  const findings = parsedFindings;

  if (highSeverityFinding && !findings.some((finding) =>
    finding.severity === "high" || finding.severity === "critical")) {
    if (npmInspection) logAuditDiagnostic(
      { ...npmInspection.diagnostic, reason: "audit_exit_without_high_severity" }, result
    );
    return {
    id: "security", category: "security", name: "Dependency Security",
    status: "error", command: auditCommand.display, exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary: "Dependency audit exited unsuccessfully without matching high-risk findings.",
    stdout: result.stdout, stderr: result.stderr,
  };
  }

  const securityEvidence =
  createSecurityEvidence(
    findings
  );

  if (highSeverityFinding || findings.some((finding) =>
    finding.severity === "high" || finding.severity === "critical")) {
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

    ...(securityEvidence.length > 0
      ? {
          evidence:
            securityEvidence,
        }
      : {}),
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
      ...(securityEvidence.length > 0
  ? {
      evidence:
        securityEvidence,
    }
  : {}),
  };
}
