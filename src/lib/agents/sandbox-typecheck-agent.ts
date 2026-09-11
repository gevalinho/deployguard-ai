import {
  existsSync,
} from "node:fs";

import {
  join,
} from "node:path";

import type {
  CheckResult,
} from "@/lib/checks/types";

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

export async function runSandboxTypecheckAgent(
  repositoryPath: string
): Promise<CheckResult> {
  const tsconfigPath =
    join(
      repositoryPath,
      "tsconfig.json"
    );

  if (!existsSync(tsconfigPath)) {
    return {
      id: "types",
      category: "types",
      name: "TypeScript",
      status: "skipped",
      skipReason: "not_applicable",
      summary:
        "No tsconfig.json was detected.",
    };
  }

  const packageManager =
    detectPackageManager(
      repositoryPath
    );

  if (!packageManager) {
    return {
      id: "types",
      category: "types",
      name: "TypeScript",
      status: "skipped",
      skipReason: "unsupported",
      summary:
        "No supported package manager lockfile was detected.",
    };
  }

  const corepackConfig =
  getCorepackSandboxConfig(
    packageManager,
    true
  );

  const typecheckCommand =
    createExecCommand(
      packageManager,
      "tsc",
      [
        "--noEmit",
      ]
    );

  const result =
    await runDockerSandboxCommand({
      repositoryPath,

      command:
        typecheckCommand.command,

      network:
        "none",

      // environment: {
        
        
      //   CI:
      //     "true",
      //   HOME:
      //     "/tmp/deployguard-home",
      // },

      environment: {
  ...corepackConfig.environment,
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
          5 * 60 * 1000,
      },
    });

  if (
    result.status ===
    "timed_out"
  ) {
    return {
      id: "types",
      category: "types",
      name: "TypeScript",
      status: "error",
      command:
        typecheckCommand.display,
      exitCode:
        result.exitCode,
      durationMs:
        result.durationMs,
      summary:
        "TypeScript validation exceeded the sandbox timeout.",
      stdout:
        result.stdout,
      stderr:
        result.stderr,
    };
  }

  return {
    id: "types",
    category: "types",
    name: "TypeScript",

    status:
      result.status === "passed"
        ? "passed"
        : "failed",

    command:
      typecheckCommand.display,

    exitCode:
      result.exitCode,

    durationMs:
      result.durationMs,

    summary:
      result.status === "passed"
        ? "TypeScript validation passed inside the sandbox."
        : "TypeScript validation failed inside the sandbox.",

    stdout:
      result.stdout,

    stderr:
      result.stderr,
  };
}