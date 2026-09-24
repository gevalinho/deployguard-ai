import type {
  FixExecutionResult,
  FixProposal,
} from "@/lib/remediation/types";

import {
  runDockerSandboxCommand,
} from "@/lib/sandbox/docker-sandbox";

import {
  detectPackageManager,
} from "@/lib/sandbox/package-manager";

import {
  createExecCommand,
} from "@/lib/sandbox/package-manager-command";

import {
  getCorepackSandboxConfig,
} from "@/lib/sandbox/corepack-cache";

const FIX_TIMEOUT_MS =
  5 * 60 * 1000;

export async function applyLintAutofix(
  repositoryPath: string,
  proposal: FixProposal
): Promise<FixExecutionResult> {
  if (
    proposal.strategy !==
    "lint_autofix"
  ) {
    return {
      status: "unsupported",
      summary:
        "This remediation strategy is not supported by the lint autofix executor.",
    };
  }

  const packageManager =
    detectPackageManager(
      repositoryPath
    );

  if (!packageManager) {
    return {
      status: "unsupported",
      summary:
        "No supported package manager lockfile was detected.",
    };
  }

  const corepackConfig =
    getCorepackSandboxConfig(
      packageManager,
      true
    );

  /*
   * DeployGuard chooses the executable and
   * arguments.
   *
   * Neither the AI nor the user supplies an
   * arbitrary command.
   */
  const fixCommand =
    createExecCommand(
      packageManager,
      "eslint",
      [
        ".",
        "--fix",
      ]
    );

  const result =
    await runDockerSandboxCommand({
      repositoryPath,

      command:
        fixCommand.command,

      /*
       * ESLint autofix should not require
       * network access. Dependencies were
       * prepared before remediation.
       */
      network: "none",

      environment: {
        ...corepackConfig.environment,

        HOME:
          "/tmp/deployguard-home",

        CI: "true",
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
        memoryMb: 2048,
        cpus: 1,
        timeoutMs:
          FIX_TIMEOUT_MS,
      },
    });

  if (
    result.status ===
    "timed_out"
  ) {
    return {
      status: "failed",
      summary:
        "Lint autofix exceeded the configured timeout.",
      command:
        fixCommand.display,
      exitCode:
        result.exitCode,
      durationMs:
        result.durationMs,
    };
  }

  if (
    result.status === "failed"
  ) {
    return {
      status: "failed",
      summary:
        "ESLint could not complete the controlled autofix attempt.",
      command:
        fixCommand.display,
      exitCode:
        result.exitCode,
      durationMs:
        result.durationMs,
    };
  }

  return {
    status: "applied",
    summary:
      "ESLint completed the controlled autofix attempt.",
    command:
      fixCommand.display,
    exitCode:
      result.exitCode,
    durationMs:
      result.durationMs,
  };
}