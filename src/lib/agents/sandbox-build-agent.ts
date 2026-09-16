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

const MAX_BUILD_EVIDENCE = 10;

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function normalizeWorkspacePath(value: string): string {
  return value
    .replace(/^\/workspace\//, "")
    .replace(/^\.\//, "")
    .replace(/^\/workspace$/, ".");
}

function extractBuildEvidence(
  stdout: string,
  stderr: string
): CheckEvidence[] {
  const output = stripAnsi(`${stdout}\n${stderr}`);

  const lines = output
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));

  const evidence: CheckEvidence[] = [];
  const seen = new Set<string>();

  let currentFile: string | undefined;

  const addEvidence = (item: CheckEvidence) => {
    const key = [
      item.kind,
      item.file ?? "",
      item.line ?? "",
      item.column ?? "",
      item.message,
    ].join("|");

    if (
      seen.has(key) ||
      evidence.length >= MAX_BUILD_EVIDENCE
    ) {
      return;
    }

    seen.add(key);
    evidence.push(item);
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      continue;
    }

    /*
     * Next.js commonly prints a source file on its own line:
     *
     * ./app/login/page.tsx
     * Module not found: Can't resolve './loginApiCalls'
     */
    const isFilePath =
      (trimmed.startsWith("./") ||
        trimmed.startsWith("/workspace/")) &&
      /\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/.test(trimmed);

    if (isFilePath) {
      currentFile = normalizeWorkspacePath(trimmed);
      continue;
    }

    /*
     * Source location emitted by the Next.js compiler:
     *
     * ,-[/workspace/app/layout.tsx:9:1]
     */
    const locationMatch = trimmed.match(
      /\/workspace\/(.+?\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)):(\d+):(\d+)/
    );

    if (locationMatch) {
      const [, file, lineNumber, columnNumber] =
        locationMatch;

      addEvidence({
        kind: "diagnostic",
        message: "Build failure source location.",
        file: normalizeWorkspacePath(file),
        line: Number(lineNumber),
        column: Number(columnNumber),
      });

      continue;
    }

    /*
     * Next.js / webpack / compiler errors.
     */
    const explicitErrorMatch = trimmed.match(
      /^(ReactServerComponentsError|Module not found|Type error|SyntaxError|ReferenceError|Build error|Error):?\s*(.*)$/i
    );

    if (explicitErrorMatch) {
      const [, errorType, rawMessage] =
        explicitErrorMatch;

      const message = rawMessage.trim()
        ? `${errorType}: ${rawMessage.trim()}`
        : errorType;

      addEvidence({
        kind: "error",
        message,
        file: currentFile,
      });

      continue;
    }

    /*
     * Terminal build failure markers.
     */
    if (
      /Failed to compile|Build failed because of webpack errors|failed to build|compilation failed|export encountered an error|prerender error/i.test(
        trimmed
      )
    ) {
      addEvidence({
        kind: "error",
        message: trimmed,
        file: currentFile,
      });

      continue;
    }

    /*
     * ReactServerComponentsError often puts its explanation
     * on the following non-empty line.
     */
    const latest = evidence[evidence.length - 1];

    if (
      latest &&
      latest.file === currentFile &&
      latest.message === "ReactServerComponentsError" &&
      !trimmed.startsWith(",-[") &&
      !trimmed.startsWith(":") &&
      !trimmed.startsWith("`") &&
      !trimmed.startsWith("File path:")
    ) {
      latest.message =
        `${latest.message}: ${trimmed}`;
    }
  }

  return evidence.slice(0, MAX_BUILD_EVIDENCE);
}

function extractNetworkEvidence(
  stdout: string,
  stderr: string
): CheckEvidence[] {
  const output = stripAnsi(`${stdout}\n${stderr}`);

  const networkLine = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) =>
      /Failed to fetch|fonts\.googleapis\.com|ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed|network/i.test(
        line
      )
    );

  if (!networkLine) {
    return [];
  }

  return [
    {
      kind: "diagnostic",
      message:
        networkLine.length > 300
          ? `${networkLine.slice(0, 297)}...`
          : networkLine,
    },
  ];
}

function createBuildFailureSummary(
  evidence: CheckEvidence[]
): string {
  if (evidence.length === 0) {
    return (
      "Production build failed inside the sandbox, " +
      "but DeployGuard could not extract structured build failure evidence."
    );
  }

  const location = evidence.find(
    (item) => item.file !== undefined
  );

  return (
    `Production build failed with ${evidence.length} ` +
    `captured failure evidence item${
      evidence.length === 1 ? "" : "s"
    }.` +
    (location?.file
      ? ` A detected failure is associated with ${location.file}${
          location.line ? `:${location.line}` : ""
        }.`
      : "")
  );
}

export async function runSandboxBuildAgent(
  repositoryPath: string
): Promise<CheckResult> {
  const packageJsonPath = join(
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
      summary: "No package.json was detected.",
    };
  }

  const packageManager =
    detectPackageManager(repositoryPath);

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

  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, "utf8")
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
      command: buildCommand.command,
      network: "none",

      environment: {
        NODE_ENV: "production",
        CI: "true",
        HOME: "/tmp/deployguard-home",
        ...corepackConfig.environment,
      },

      mounts: [
        ...corepackConfig.mounts,
      ],

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
      id: "build",
      category: "build",
      name: "Production Build",
      status: "error",
      command: buildCommand.display,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      summary:
        "Production build exceeded the sandbox timeout.",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const combinedOutput =
    `${result.stdout}\n${result.stderr}`;

  const networkDependencyFailure =
    /Failed to fetch|fonts\.googleapis\.com|ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed/i.test(
      combinedOutput
    );

  const status =
    result.status === "passed"
      ? "passed"
      : networkDependencyFailure
        ? "blocked"
        : "failed";

  const evidence =
    status === "passed"
      ? []
      : status === "blocked"
        ? extractNetworkEvidence(
            result.stdout,
            result.stderr
          )
        : extractBuildEvidence(
            result.stdout,
            result.stderr
          );

  return {
    id: "build",
    category: "build",
    name: "Production Build",
    status,

    command: buildCommand.display,
    exitCode: result.exitCode,
    durationMs: result.durationMs,

    summary:
      status === "passed"
        ? "Production build passed inside the sandbox."
        : status === "blocked"
          ? (
              "Production build could not be fully verified because " +
              "the isolated sandbox blocked required external network access."
            )
          : createBuildFailureSummary(evidence),

    evidence:
      evidence.length > 0
        ? evidence
        : undefined,

    stdout: result.stdout,
    stderr: result.stderr,
  };
}