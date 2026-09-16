import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  CheckEvidence,
  CheckResult,
} from "@/lib/checks/types";

import { runDockerSandboxCommand } from "@/lib/sandbox/docker-sandbox";
import { detectPackageManager } from "@/lib/sandbox/package-manager";
import { createRunScriptCommand } from "@/lib/sandbox/package-manager-command";
import { getCorepackSandboxConfig } from "@/lib/sandbox/corepack-cache";

interface PackageJson {
  scripts?: Record<string, string>;
}

const MAX_LINT_EVIDENCE = 10;

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function normalizeWorkspacePath(value: string): string {
  return value
    .replace(/^\/workspace\//, "")
    .replace(/^\/workspace$/, ".");
}

function extractLintEvidence(
  stdout: string,
  stderr: string
): CheckEvidence[] {
  const output = stripAnsi(`${stdout}\n${stderr}`);
  const evidence: CheckEvidence[] = [];

  let currentFile: string | undefined;

  /*
   * Common ESLint stylish output:
   *
   * /workspace/src/app/page.tsx
   *   12:5  error  Unexpected any  @typescript-eslint/no-explicit-any
   */
  const diagnosticPattern =
  /^\s*(\d+):(\d+)\s+(error|warning):?\s+(.+?)(?:\s{2,}(\S+))?\s*$/i;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const diagnosticMatch = line.match(diagnosticPattern);

    if (diagnosticMatch) {
      const [
        ,
        lineNumber,
        columnNumber,
        severity,
        rawMessage,
        ruleId,
      ] = diagnosticMatch;

      evidence.push({
        kind: severity === "warning" ? "warning" : "error",
        message: rawMessage.trim(),
        file: currentFile,
        line: Number(lineNumber),
        column: Number(columnNumber),
        code: ruleId?.trim(),
      });

      if (evidence.length >= MAX_LINT_EVIDENCE) {
        break;
      }

      continue;
    }

    /*
     * ESLint stylish output normally prints the file path
     * immediately before that file's diagnostics.
     */
    const isFilePath =
      !line.startsWith(" ") &&
      !line.startsWith("\t") &&
      (trimmed.startsWith("/") ||
        /^[A-Za-z]:[\\/]/.test(trimmed) ||
        /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/.test(trimmed));

    if (isFilePath) {
      currentFile = normalizeWorkspacePath(trimmed);
    }
  }

  return evidence;
}

function createLintFailureSummary(
  evidence: CheckEvidence[]
): string {
  if (evidence.length === 0) {
    return (
      "Linting failed inside the sandbox, " +
      "but DeployGuard could not extract structured lint diagnostics."
    );
  }

  const errorCount = evidence.filter(
    (item) => item.kind === "error"
  ).length;

  const warningCount = evidence.filter(
    (item) => item.kind === "warning"
  ).length;

  const parts: string[] = [];

  if (errorCount > 0) {
    parts.push(
      `${errorCount} error${errorCount === 1 ? "" : "s"}`
    );
  }

  if (warningCount > 0) {
    parts.push(
      `${warningCount} warning${warningCount === 1 ? "" : "s"}`
    );
  }

  const first = evidence[0];

  const location = first.file
    ? ` The first captured issue is in ${first.file}${
        first.line ? `:${first.line}` : ""
      }.`
    : "";

  return (
    `Linting failed with ${parts.join(
      " and "
    )} captured by DeployGuard.` + location
  );
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
      summary: "No package.json was detected.",
    };
  }

  const packageManager = detectPackageManager(repositoryPath);

  if (!packageManager) {
    return {
      id: "lint",
      category: "lint",
      name: "Lint",
      status: "skipped",
      skipReason: "unsupported",
      summary:
        "No supported package manager lockfile was detected.",
    };
  }

  const corepackConfig = getCorepackSandboxConfig(
    packageManager,
    true
  );

  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, "utf8")
  ) as PackageJson;

  if (!packageJson.scripts?.lint) {
    return {
      id: "lint",
      category: "lint",
      name: "Lint",
      status: "skipped",
      skipReason: "not_configured",
      summary: "No lint script is configured.",
    };
  }

  const lintCommand = createRunScriptCommand(
    packageManager,
    "lint"
  );

  const result = await runDockerSandboxCommand({
    repositoryPath,
    command: lintCommand.command,
    network: "none",

    environment: {
      ...corepackConfig.environment,
      CI: "true",
      HOME: "/tmp/deployguard-home",
    },

    mounts: [...corepackConfig.mounts],

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
      command: lintCommand.display,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      summary: "Linting exceeded the sandbox timeout.",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  /*
   * TEMPORARY DEBUGGING:
   * Remove this once we understand the failing repository's
   * lint output and update extractLintEvidence().
   */
  

  const evidence =
    result.status === "passed"
      ? []
      : extractLintEvidence(result.stdout, result.stderr);

  return {
    id: "lint",
    category: "lint",
    name: "Lint",

    status:
      result.status === "passed" ? "passed" : "failed",

    command: lintCommand.display,
    exitCode: result.exitCode,
    durationMs: result.durationMs,

    summary:
      result.status === "passed"
        ? "Linting passed inside the sandbox."
        : createLintFailureSummary(evidence),

    evidence:
      evidence.length > 0 ? evidence : undefined,

    stdout: result.stdout,
    stderr: result.stderr,
  };
}