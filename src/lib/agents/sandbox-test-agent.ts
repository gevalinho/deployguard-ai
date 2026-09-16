import {
  existsSync,
  readFileSync,
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
  createRunScriptCommand,
} from "@/lib/sandbox/package-manager-command";

import {
  getCorepackSandboxConfig,
} from "@/lib/sandbox/corepack-cache";

interface PackageJson {
  scripts?: Record<string, string>;
}

const MAX_TEST_EVIDENCE = 10;

function stripAnsi(value: string): string {
  return value.replace(
    /\u001b\[[0-9;]*m/g,
    ""
  );
}

function normalizeWorkspacePath(
  value: string
): string {
  return value
    .replace(/^\/workspace\//, "")
    .replace(/^\/workspace$/, ".");
}

function extractTestEvidence(
  stdout: string,
  stderr: string
): CheckEvidence[] {
  const combinedOutput =
    stripAnsi(`${stdout}\n${stderr}`);

  const evidence: CheckEvidence[] = [];
  const seen = new Set<string>();

  const addEvidence = (
    item: CheckEvidence
  ) => {
    const key = [
      item.kind,
      item.file ?? "",
      item.line ?? "",
      item.column ?? "",
      item.message,
    ].join("|");

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    evidence.push(item);
  };

  const lines =
    combinedOutput.split("\n");

  /*
   * Jest/Vitest-style failed suite lines:
   *
   * FAIL __tests__/login.test.ts
   * FAIL src/example.test.ts > user login
   */
  for (const rawLine of lines) {
    const line = rawLine.trim();

    const failedSuiteMatch =
      line.match(
        /^FAIL\s+(.+?)(?:\s+>\s+.*)?$/
      );

    if (failedSuiteMatch) {
      const candidate =
        failedSuiteMatch[1]
          .trim()
          .split(/\s+/)[0];

      addEvidence({
        kind: "test_failure",
        message:
          `Test suite failed: ${candidate}`,
        file:
          normalizeWorkspacePath(
            candidate
          ),
      });
    }

    if (
      evidence.length >=
      MAX_TEST_EVIDENCE
    ) {
      break;
    }
  }

  /*
   * Jest assertion/failure headings commonly look like:
   *
   * ● loginApiCalls › should return user
   */
  if (
    evidence.length <
    MAX_TEST_EVIDENCE
  ) {
    for (const rawLine of lines) {
      const line = rawLine.trim();

      const failureMatch =
        line.match(
          /^●\s+(.+)$/
        );

      if (!failureMatch) {
        continue;
      }

      addEvidence({
        kind: "test_failure",
        message:
          failureMatch[1].trim(),
      });

      if (
        evidence.length >=
        MAX_TEST_EVIDENCE
      ) {
        break;
      }
    }
  }

  /*
   * Capture useful source locations from stack traces:
   *
   * at Object.<anonymous> (__tests__/foo.test.ts:12:5)
   * at src/foo.test.ts:12:5
   */
  if (
    evidence.length <
    MAX_TEST_EVIDENCE
  ) {
    for (const rawLine of lines) {
      const line = rawLine.trim();

      const locationMatch =
        line.match(
          /(?:\(|\s)(\/workspace\/)?([^()\s]+?\.(?:js|jsx|ts|tsx|mjs|cjs)):(\d+):(\d+)\)?$/
        );

      if (!locationMatch) {
        continue;
      }

      const [
        ,
        workspacePrefix,
        file,
        lineNumber,
        columnNumber,
      ] = locationMatch;

      const normalizedFile =
        normalizeWorkspacePath(
          `${workspacePrefix ?? ""}${file}`
        );

      addEvidence({
        kind: "diagnostic",
        message:
          "Failure stack trace location.",
        file:
          normalizedFile,
        line:
          Number(lineNumber),
        column:
          Number(columnNumber),
      });

      if (
        evidence.length >=
        MAX_TEST_EVIDENCE
      ) {
        break;
      }
    }
  }

  return evidence.slice(
    0,
    MAX_TEST_EVIDENCE
  );
}

function extractTestCounts(
  stdout: string,
  stderr: string
): {
  failed?: number;
  passed?: number;
  total?: number;
} {
  const output =
    stripAnsi(`${stdout}\n${stderr}`);

  /*
   * Jest:
   * Tests: 4 failed, 8 passed, 12 total
   */
  const testsLine =
    output.match(
      /Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed,\s*)?(\d+)\s+total/i
    );

  if (testsLine) {
    return {
      failed:
        testsLine[1]
          ? Number(testsLine[1])
          : 0,
      passed:
        testsLine[2]
          ? Number(testsLine[2])
          : 0,
      total:
        Number(testsLine[3]),
    };
  }

  return {};
}

function createTestFailureSummary(
  evidence: CheckEvidence[],
  counts: {
    failed?: number;
    passed?: number;
    total?: number;
  }
): string {
  if (
    counts.failed !== undefined &&
    counts.total !== undefined
  ) {
    return (
      `Tests failed: ${counts.failed} of ` +
      `${counts.total} test${
        counts.total === 1
          ? ""
          : "s"
      } failed.${
        evidence.length > 0
          ? ` DeployGuard captured ${evidence.length} structured failure evidence item${
              evidence.length === 1
                ? ""
                : "s"
            }.`
          : ""
      }`
    );
  }

  if (evidence.length > 0) {
    return (
      `Tests failed with ${evidence.length} ` +
      `captured failure evidence item${
        evidence.length === 1
          ? ""
          : "s"
      }.`
    );
  }

  return (
    "Tests failed inside the sandbox, " +
    "but DeployGuard could not extract structured test failure evidence."
  );
}

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
      skipReason:
        "not_applicable",
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
      skipReason:
        "not_configured",
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

  const evidence =
    result.status === "passed"
      ? []
      : extractTestEvidence(
          result.stdout,
          result.stderr
        );

  const counts =
    result.status === "passed"
      ? {}
      : extractTestCounts(
          result.stdout,
          result.stderr
        );

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
        : createTestFailureSummary(
            evidence,
            counts
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