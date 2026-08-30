import type { CheckResult } from "@/lib/checks/types";
import { runCommand } from "@/lib/execution/command-runner";
import type { RepositoryScanResult } from "@/lib/scanner/types";

export async function runLintAgent(
  scan: RepositoryScanResult
): Promise<CheckResult> {
  const result = await runCommand(
    "npm",
    ["run", "lint"],
    scan.repositoryPath
  );

  return {
    id: "lint-check",
    category: "lint",
    name: "Lint Check",
    status: result.status,
    command: "npm run lint",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary:
      result.status === "passed"
        ? "Lint validation completed successfully."
        : "Lint validation failed.",
    stdout: result.stdout,
    stderr: result.stderr,
  };
}