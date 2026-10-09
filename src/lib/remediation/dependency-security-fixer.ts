import type { FixExecutionResult, FixProposal } from "@/lib/remediation/types";

import { runDockerSandboxCommand } from "@/lib/sandbox/docker-sandbox";

import { detectPackageManager } from "@/lib/sandbox/package-manager";

const FIX_TIMEOUT_MS = 120_000;

export async function applyDependencySecurityFix(
  repositoryPath: string,
  proposal: FixProposal,
): Promise<FixExecutionResult> {
  if (proposal.strategy !== "dependency_security") {
    return {
      status: "unsupported",
      summary:
        "This remediation strategy is not supported by the dependency security fixer.",
    };
  }

  const packageManager = detectPackageManager(repositoryPath);

  if (!packageManager) {
    return {
      status: "unsupported",
      summary: "No supported package manager lockfile was detected.",
    };
  }

  /*
   * The first remediation implementation is
   * intentionally restricted to npm.
   *
   * pnpm and Yarn can be added after their
   * mutation and lockfile behavior has been
   * independently tested.
   */
  if (packageManager.name !== "npm") {
    return {
      status: "unsupported",
      summary: `Automatic dependency remediation is not yet supported for ${packageManager.name}.`,
    };
  }

  const command =
    proposal.risk === "breaking_change_allowed"
      ? [
          "npm",
          "audit",
          "fix",
          "--force",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ]
      : ["npm", "audit", "fix", "--ignore-scripts", "--no-audit", "--no-fund"];

  const result = await runDockerSandboxCommand({
    repositoryPath,

    command,

    network: "bridge",

    environment: {
      HOME: "/tmp/deployguard-home",

      CI: "true",

      npm_config_cache: "/tmp/npm-cache",
    },

    user:
      typeof process.getuid === "function" &&
      typeof process.getgid === "function"
        ? `${process.getuid()}:${process.getgid()}`
        : "1000:1000",

    limits: {
      memoryMb: 2048,
      cpus: 1,
      timeoutMs: FIX_TIMEOUT_MS,
    },
  });

  const sanitizedStderr = result.stderr
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
    .replace(
      /(?:token|password|authorization|_authToken)\s*[:=]\s*\S+/gi,
      "[REDACTED_CREDENTIAL]",
    )
    .slice(0, 2000);

  if (result.status === "failed") {
    console.error("[DeployGuard Remediation stderr]", sanitizedStderr);
  }

  console.error("[DeployGuard Remediation Diagnostic]", {
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutLength: result.stdout.length,
    stderrLength: result.stderr.length,
    stdoutHasERESOLVE: result.stdout.includes("ERESOLVE"),
    stderrHasERESOLVE: result.stderr.includes("ERESOLVE"),
    stdoutHasEACCES: result.stdout.includes("EACCES"),
    stderrHasEACCES: result.stderr.includes("EACCES"),
    hasRegistryError: /ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN/.test(
      result.stdout + result.stderr,
    ),
    hasAuditError: /audit endpoint|audit error|EAUDIT/i.test(
      result.stdout + result.stderr,
    ),
  });

  if (result.status === "timed_out") {
    return {
      status: "failed",
      summary: "Dependency remediation exceeded the configured timeout.",
      command: "npm audit fix",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    };
  }

  if (result.status === "failed") {
    console.error("[DeployGuard Remediation] npm audit fix failed", {
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      // Do not log raw stdout/stderr here:
      // npm output may contain credentials or private registry URLs.
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    });

    return {
      status: "failed",
      summary: "npm could not complete the dependency security remediation.",
      command: "npm audit fix",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    };
  }

  return {
    status: "applied",
    summary: "npm completed the dependency security remediation attempt.",
    command: "npm audit fix",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  };
}
