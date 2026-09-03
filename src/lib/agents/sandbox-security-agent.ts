import { existsSync } from "node:fs";
import { join } from "node:path";

import type { CheckResult } from "@/lib/checks/types";
import { runDockerSandboxCommand } from "@/lib/sandbox/docker-sandbox";

export async function runSandboxSecurityAgent(
  repositoryPath: string
): Promise<CheckResult> {
  const packageLockPath = join(
    repositoryPath,
    "package-lock.json"
  );

  if (!existsSync(packageLockPath)) {
    return {
      id: "security",
      category: "security",
      name: "Dependency Security",
      status: "skipped",
      skipReason: "not_applicable",
      summary:
        "No npm package-lock.json was detected.",
    };
  }

  const result =
    await runDockerSandboxCommand({
      repositoryPath,

      command: [
        "npm",
        "audit",
        "--audit-level=high",
        "--json",
      ],

      // Security auditing requires
      // registry access.
      network: "bridge",

      environment: {
        CI: "true",
        HOME: "/tmp/deployguard-home",
        npm_config_cache:
          "/tmp/npm-cache",
      },

      user:
        typeof process.getuid === "function" &&
        typeof process.getgid === "function"
          ? `${process.getuid()}:${process.getgid()}`
          : "1000:1000",

      limits: {
        memoryMb: 1024,
        cpus: 1,
        timeoutMs:
          2 * 60 * 1000,
      },
    });

  if (result.status === "timed_out") {
    return {
      id: "security",
      category: "security",
      name: "Dependency Security",
      status: "error",
      command:
        "npm audit --audit-level=high --json",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      summary:
        "Dependency security audit exceeded the sandbox timeout.",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  if (result.status === "passed") {
    return {
      id: "security",
      category: "security",
      name: "Dependency Security",
      status: "passed",
      command:
        "npm audit --audit-level=high --json",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      summary:
        "No high-severity dependency vulnerabilities were reported.",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const combinedOutput =
    `${result.stdout}\n${result.stderr}`;

  const looksLikeInfrastructureFailure =
    /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network|registry/i.test(
      combinedOutput
    );

  if (looksLikeInfrastructureFailure) {
    return {
      id: "security",
      category: "security",
      name: "Dependency Security",
      status: "error",
      command:
        "npm audit --audit-level=high --json",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      summary:
        "Dependency security audit could not be completed because of a network or registry error.",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    id: "security",
    category: "security",
    name: "Dependency Security",
    status: "failed",
    command:
      "npm audit --audit-level=high --json",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary:
      "High-severity dependency vulnerabilities were reported.",
    stdout: result.stdout,
    stderr: result.stderr,
  };
}