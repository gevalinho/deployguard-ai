import {
  existsSync,
} from "node:fs";

import {
  join,
} from "node:path";

import type {
  CheckEvidence,
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

const MAX_TYPECHECK_EVIDENCE = 10;

function extractTypeScriptEvidence(
  stdout: string,
  stderr: string
): CheckEvidence[] {
  const combinedOutput =
    `${stdout}\n${stderr}`;

  const evidence: CheckEvidence[] = [];

  /*
   * Typical TypeScript diagnostic:
   *
   * src/app/page.tsx(12,5): error TS2322:
   * Type 'string' is not assignable to type 'number'.
   */
  const diagnosticPattern =
    /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

  for (
    const rawLine of combinedOutput.split(
      "\n"
    )
  ) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const match =
      line.match(
        diagnosticPattern
      );

    if (!match) {
      continue;
    }

    const [
      ,
      file,
      lineNumber,
      columnNumber,
      severity,
      code,
      message,
    ] = match;

    evidence.push({
      kind:
        severity === "warning"
          ? "warning"
          : "error",
      message:
        message.trim(),
      file:
        file.trim(),
      line:
        Number(lineNumber),
      column:
        Number(columnNumber),
      code,
    });

    if (
      evidence.length >=
      MAX_TYPECHECK_EVIDENCE
    ) {
      break;
    }
  }

  return evidence;
}

function createTypeScriptFailureSummary(
  evidence: CheckEvidence[]
): string {
  if (evidence.length === 0) {
    return (
      "TypeScript validation failed inside the sandbox, " +
      "but DeployGuard could not extract structured compiler diagnostics."
    );
  }

  const total =
    evidence.length;

  const first =
    evidence[0];

  const location =
    first.file
      ? ` The first detected error is in ${first.file}${
          first.line
            ? `:${first.line}`
            : ""
        }.`
      : "";

  return (
    `TypeScript validation failed with ${total} ` +
    `captured compiler diagnostic${
      total === 1
        ? ""
        : "s"
    }.${location}`
  );
}

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
      skipReason:
        "not_applicable",
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
      skipReason:
        "unsupported",
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
        "--pretty",
        "false",
      ]
    );

  const result =
    await runDockerSandboxCommand({
      repositoryPath,

      command:
        typecheckCommand.command,

      network:
        "none",

      environment: {
        ...corepackConfig.environment,
        CI: "true",
        HOME:
          "/tmp/deployguard-home",
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

  const evidence =
    result.status === "passed"
      ? []
      : extractTypeScriptEvidence(
          result.stdout,
          result.stderr
        );

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
        : createTypeScriptFailureSummary(
            evidence
          ),

    evidence:
      evidence.length > 0
        ? evidence
        : undefined,

    stdout:
      result.stdout,

    stderr:
      result.stderr,
  };
}