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

import {
  getCorepackSandboxConfig,
} from "@/lib/sandbox/corepack-cache";

interface PackageJson {
  scripts?: Record<string, string>;
}

export async function runSandboxBuildAgent(
  repositoryPath: string
): Promise<CheckResult> {
  const packageJsonPath =
    join(
      repositoryPath,
      "package.json"
    );

  if (!existsSync(packageJsonPath)) {
    return {
      id: "build",
      category: "build",
      name: "Production Build",
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
      id: "build",
      category: "build",
      name: "Production Build",
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

  if (!packageJson.scripts?.build) {
    return {
      id: "build",
      category: "build",
      name: "Production Build",
      status: "skipped",
      skipReason: "not_configured",
      summary:
        "No build script is configured.",
    };
  }

  const buildCommand =
    createRunScriptCommand(
      packageManager,
      "build"
    );

  const result =
    await runDockerSandboxCommand({
      repositoryPath,

      command:
        buildCommand.command,

      network: "none",

      // environment: {
      //   NODE_ENV:
      //     "production",
      //   CI:
      //     "true",
      //   HOME:
      //     "/tmp/deployguard-home",
      // },

      environment: {
  NODE_ENV: "production",
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
      id: "build",
      category: "build",
      name: "Production Build",
      status: "error",
      command:
        buildCommand.display,
      exitCode:
        result.exitCode,
      durationMs:
        result.durationMs,
      summary:
        "Production build exceeded the sandbox timeout.",
      stdout:
        result.stdout,
      stderr:
        result.stderr,
    };
  }

  const combinedOutput =
    `${result.stdout}\n${result.stderr}`;

  const networkDependencyFailure =
    /Failed to fetch|fonts\.googleapis\.com|network|ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(
      combinedOutput
    );

  return {
    id: "build",
    category: "build",
    name: "Production Build",

    status:
      result.status === "passed"
        ? "passed"
        : networkDependencyFailure
          ? "error"
          : "failed",

    command:
      buildCommand.display,

    exitCode:
      result.exitCode,

    durationMs:
      result.durationMs,

    summary:
      result.status === "passed"
        ? "Production build passed inside the sandbox."
        : networkDependencyFailure
          ? "Production build requires external network access that is blocked by the sandbox."
          : "Production build failed inside the sandbox.",

    stdout:
      result.stdout,

    stderr:
      result.stderr,
  };
}