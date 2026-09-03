import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CheckResult } from "@/lib/checks/types";
import { runDockerSandboxCommand } from "@/lib/sandbox/docker-sandbox";

interface PackageJson {
  scripts?: Record<string, string>;
}

export async function runSandboxLintAgent(
  repositoryPath: string
): Promise<CheckResult> {
  const packageJsonPath = join(
    repositoryPath,
    "package.json"
  );

  if (!existsSync(packageJsonPath)) {
    return {
      id: "lint",
      category: "lint",
      name: "Lint",
      status: "skipped",
      skipReason: "not_applicable",
      summary:
        "No package.json was detected.",
    };
  }

  const packageJson = JSON.parse(
    readFileSync(
      packageJsonPath,
      "utf8"
    )
  ) as PackageJson;

  if (!packageJson.scripts?.lint) {
    return {
      id: "lint",
      category: "lint",
      name: "Lint",
      status: "skipped",
      skipReason: "not_configured",
      summary:
        "No lint script is configured.",
    };
  }

  const result =
    await runDockerSandboxCommand({
      repositoryPath,

      command: [
        "npm",
        "run",
        "lint",
      ],

      network: "none",

      environment: {
        CI: "true",
        HOME: "/tmp/deployguard-home",
      },

      user:
        typeof process.getuid === "function" &&
        typeof process.getgid === "function"
          ? `${process.getuid()}:${process.getgid()}`
          : "1000:1000",

      limits: {
        memoryMb: 2048,
        cpus: 1,
        timeoutMs: 5 * 60 * 1000,
      },
    });

  if (result.status === "timed_out") {
    return {
      id: "lint",
      category: "lint",
      name: "Lint",
      status: "error",
      command: "npm run lint",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      summary:
        "Linting exceeded the sandbox timeout.",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    id: "lint",
    category: "lint",
    name: "Lint",

    status:
      result.status === "passed"
        ? "passed"
        : "failed",

    command: "npm run lint",
    exitCode: result.exitCode,
    durationMs: result.durationMs,

    summary:
      result.status === "passed"
        ? "Linting passed inside the sandbox."
        : "Linting failed inside the sandbox.",

    stdout: result.stdout,
    stderr: result.stderr,
  };
}