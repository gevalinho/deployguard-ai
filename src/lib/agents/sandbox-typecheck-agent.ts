import { existsSync } from "node:fs";
import { join } from "node:path";

import type { CheckResult } from "@/lib/checks/types";
import { runDockerSandboxCommand } from "@/lib/sandbox/docker-sandbox";

export async function runSandboxTypecheckAgent(
  repositoryPath: string
): Promise<CheckResult> {
  const tsconfigPath = join(
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

  const result =
    await runDockerSandboxCommand({
      repositoryPath,

      command: [
        "./node_modules/.bin/tsc",
        "--noEmit",
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
      id: "types",
      category: "types",
      name: "TypeScript",
      status: "error",
      command:
        "./node_modules/.bin/tsc --noEmit",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      summary:
        "TypeScript validation exceeded the sandbox timeout.",
      stdout: result.stdout,
      stderr: result.stderr,
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
      "./node_modules/.bin/tsc --noEmit",

    exitCode: result.exitCode,
    durationMs: result.durationMs,

    summary:
      result.status === "passed"
        ? "TypeScript validation passed inside the sandbox."
        : "TypeScript validation failed inside the sandbox.",

    stdout: result.stdout,
    stderr: result.stderr,
  };
}