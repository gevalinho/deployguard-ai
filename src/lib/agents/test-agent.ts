import type { CheckResult } from "@/lib/checks/types";
import { runCommand } from "@/lib/execution/command-runner";
import type { RepositoryScanResult } from "@/lib/scanner/types";

function getFact(
  scan: RepositoryScanResult,
  key: string
): string | null {
  return (
    scan.facts.find((fact) => fact.key === key)?.value ?? null
  );
}

export async function runTestAgent(
  scan: RepositoryScanResult
): Promise<CheckResult> {
  const packageManager = getFact(scan, "packageManager");
  const testScript = getFact(scan, "testScript");

  if (!testScript) {
    return {
      id: "test-suite",
      category: "test",
      name: "Test Suite",
      status: "skipped",
      skipReason: "not_configured",
      summary:
        "No verified test script was detected in package.json.",
    };
  }

  if (!packageManager) {
    return {
      id: "test-suite",
      category: "test",
      name: "Test Suite",
      status: "skipped",
      summary:
        "A test script exists, but no verified package manager was detected.",
    };
  }

  let command: string;
  let args: string[];

  switch (packageManager) {
    case "npm":
      command = "npm";
      args = ["test"];
      break;

    case "pnpm":
      command = "pnpm";
      args = ["test"];
      break;

    case "Yarn":
      command = "yarn";
      args = ["test"];
      break;

    default:
      return {
        id: "test-suite",
        category: "test",
        name: "Test Suite",
        status: "skipped",
        summary: `Unsupported package manager: ${packageManager}`,
      };
  }

  const result = await runCommand(
    command,
    args,
    scan.repositoryPath
  );

  return {
    id: "test-suite",
    category: "test",
    name: "Test Suite",
    status: result.status,

    command: [command, ...args].join(" "),
    exitCode: result.exitCode,
    durationMs: result.durationMs,

    summary:
      result.status === "passed"
        ? "Repository test suite completed successfully."
        : "Repository test suite failed.",

    stdout: result.stdout,
    stderr: result.stderr,
  };
}