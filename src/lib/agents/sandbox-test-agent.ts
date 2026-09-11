import {
  existsSync,
  readFileSync,
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
  createRunScriptCommand,
} from "@/lib/sandbox/package-manager-command";

interface PackageJson {
  scripts?: Record<string, string>;
}

import {
  getCorepackSandboxConfig,
} from "@/lib/sandbox/corepack-cache";

export async function runSandboxTestAgent(
  repositoryPath: string
): Promise<CheckResult> {
  const packageJsonPath =
    join(
      repositoryPath,
      "package.json"
    );

  if (!existsSync(packageJsonPath)) {
    return {
      id: "test",
      category: "test",
      name: "Tests",
      status: "skipped",
      skipReason: "not_applicable",
      summary:
        "No package.json was detected.",
    };
  }

  const packageManager =
    detectPackageManager(
      repositoryPath
    );

  if (!packageManager) {
    return {
      id: "test",
      category: "test",
      name: "Tests",
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

  const packageJson =
    JSON.parse(
      readFileSync(
        packageJsonPath,
        "utf8"
      )
    ) as PackageJson;

  if (!packageJson.scripts?.test) {
    return {
      id: "test",
      category: "test",
      name: "Tests",
      status: "skipped",
      skipReason: "not_configured",
      summary:
        "No test script is configured.",
    };
  }

  const testCommand =
    createRunScriptCommand(
      packageManager,
      "test"
    );

  const result =
    await runDockerSandboxCommand({
      repositoryPath,

      command:
        testCommand.command,

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
      id: "test",
      category: "test",
      name: "Tests",
      status: "error",
      command:
        testCommand.display,
      exitCode:
        result.exitCode,
      durationMs:
        result.durationMs,
      summary:
        "Test execution exceeded the sandbox timeout.",
      stdout:
        result.stdout,
      stderr:
        result.stderr,
    };
  }

  return {
    id: "test",
    category: "test",
    name: "Tests",

    status:
      result.status === "passed"
        ? "passed"
        : "failed",

    command:
      testCommand.display,

    exitCode:
      result.exitCode,

    durationMs:
      result.durationMs,

    summary:
      result.status === "passed"
        ? "Tests passed inside the sandbox."
        : "Tests failed inside the sandbox.",

    stdout:
      result.stdout,

    stderr:
      result.stderr,
  };
}