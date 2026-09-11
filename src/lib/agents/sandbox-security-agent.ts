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

/*
 * Yarn Classic uses a bitmask exit code:
 *
 * 1  = informational
 * 2  = low
 * 4  = moderate
 * 8  = high
 * 16 = critical
 *
 * DeployGuard currently treats high and
 * critical dependency vulnerabilities as
 * readiness failures.
 */
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

  /*
   * npm, pnpm and modern Yarn are invoked
   * with a high-severity threshold.
   *
   * A non-zero exit after infrastructure
   * failures have been excluded is therefore
   * treated as a dependency vulnerability
   * finding.
   */
  return (
    exitCode !== null &&
    exitCode !== undefined &&
    exitCode !== 0
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
      name: "Dependency Security",
      status: "skipped",
      skipReason: "not_applicable",
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

      /*
       * Dependency auditing requires
       * package-registry access.
       */
      network:
        "bridge",

      environment: {
        CI:
          "true",

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
          2 * 60 * 1000,
      },
    });

  if (
    result.status ===
    "timed_out"
  ) {
    return {
      id: "security",
      category: "security",
      name: "Dependency Security",
      status: "error",

      command:
        auditCommand.display,

      exitCode:
        result.exitCode,

      durationMs:
        result.durationMs,

      summary:
        "Dependency security audit exceeded the sandbox timeout.",

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
      name: "Dependency Security",
      status: "error",

      command:
        auditCommand.display,

      exitCode:
        result.exitCode,

      durationMs:
        result.durationMs,

      summary:
        "Dependency security audit could not be completed because of a network or registry error.",

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

  if (highSeverityFinding) {
    return {
      id: "security",
      category: "security",
      name: "Dependency Security",
      status: "failed",

      command:
        auditCommand.display,

      exitCode:
        result.exitCode,

      durationMs:
        result.durationMs,

      summary:
        "High-severity dependency vulnerabilities were reported.",

      stdout:
        result.stdout,

      stderr:
        result.stderr,
    };
  }

  /*
   * Yarn Classic may return a non-zero exit
   * code for informational, low or moderate
   * findings. Those do not fail our current
   * high-severity readiness threshold.
   */
  return {
    id: "security",
    category: "security",
    name: "Dependency Security",
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