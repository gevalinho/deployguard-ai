import type { FixExecutionResult, FixProposal } from "@/lib/remediation/types";

import { runDockerSandboxCommand, SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";

import { detectPackageManager } from "@/lib/sandbox/package-manager";

import { chown, chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "@/lib/execution/command-runner";

const FIX_TIMEOUT_MS = 120_000;

async function cacheMetadata(path: string) {
  try {
    const details = await stat(path);
    return {
      exists: true,
      uid: details.uid,
      gid: details.gid,
      mode: (details.mode & 0o777).toString(8).padStart(3, "0"),
      isDirectory: details.isDirectory(),
    };
  } catch (error) {
    return { exists: false, errorCode: (error as NodeJS.ErrnoException).code ?? "UNKNOWN" };
  }
}

async function logCacheState(stage: "before" | "after", directory: string, uid: number, gid: number) {
  const [cache, cacache] = await Promise.all([
    cacheMetadata(directory),
    cacheMetadata(join(directory, "_cacache")),
  ]);
  let selinuxLabel: string | undefined;
  try {
    const labelResult = await runCommand(
      "ls", ["-Zd", "--", directory], directory,
      { inheritProcessEnv: false, env: { PATH: "/usr/bin:/bin" }, timeoutMs: 2_000 },
    );
    const firstField = labelResult.stdout.trim().split(/\s+/)[0];
    if (labelResult.status === "passed" && firstField?.includes(":")) {
      selinuxLabel = firstField;
    }
  } catch {
    // The metadata diagnostic must not change the remediation outcome.
  }
  console.error("[DeployGuard Remediation Cache]", {
    stage, expectedUid: uid, expectedGid: gid, cache, cacache,
    selinuxLabel: selinuxLabel ?? "unavailable",
  });
}

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

  const hostUid = typeof process.getuid === "function" ? process.getuid() : null;
  const hostGid = typeof process.getgid === "function" ? process.getgid() : null;
  const uid = hostUid && hostUid > 0 ? hostUid : 1000;
  const gid = hostUid && hostUid > 0 ? (hostGid ?? 1000) : 1000;
  const cacheDirectory = await mkdtemp(
    join(tmpdir(), "deployguard-npm-cache-"),
  );

  let result: Awaited<ReturnType<typeof runDockerSandboxCommand>> | undefined;
  let executionError: unknown;
  try {
    // mkdtemp creates a private directory. Align ownership with the Docker UID
    // when the host process runs under a different account (for example root).
    if (hostUid !== uid || hostGid !== gid) {
      await chown(cacheDirectory, uid, gid);
    }
    await chmod(cacheDirectory, 0o700);
    await logCacheState("before", cacheDirectory, uid, gid);

    result = await runDockerSandboxCommand({
      repositoryPath,
      command,
      network: "bridge",
      environment: {
        HOME: "/tmp/deployguard-home",
        CI: "true",
        npm_config_cache: "/tmp/npm-cache",
      },
      user: `${uid}:${gid}`,
      mounts: [
        {
          source: cacheDirectory,
          target: "/tmp/npm-cache",
          selinuxPrivate: true,
        },
      ],
      limits: {
        memoryMb: 2048,
        cpus: 1,
        timeoutMs: FIX_TIMEOUT_MS,
      },
    });

  } catch (error) {
    executionError = error;
    throw error;
  } finally {
    try {
      await logCacheState("after", cacheDirectory, uid, gid);
    } catch {
      // Diagnostics cannot replace the Docker result or cleanup.
    }
    if (executionError instanceof SandboxContainerStateUnknownError) {
      console.error("[DeployGuard Remediation] Cache retained because container state is unknown", {
        cacheDirectory,
      });
    } else {
      try {
        await rm(cacheDirectory, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error("[DeployGuard Remediation] Cache cleanup failed", {
          cacheDirectory,
          errorCode: (cleanupError as NodeJS.ErrnoException).code ?? "UNKNOWN",
        });
        if (!executionError && result?.status === "passed") throw cleanupError;
      }
    }
  }

  if (!result) throw new Error("Sandbox execution returned no result.");

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
