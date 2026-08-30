import type { CheckResult } from "@/lib/checks/types";
import { runCommand } from "@/lib/execution/command-runner";
import type { RepositoryScanResult } from "@/lib/scanner/types";

export async function runTypecheckAgent(
  scan: RepositoryScanResult
): Promise<CheckResult> {
  const result = await runCommand(
    "npx",
    ["tsc", "--noEmit"],
    scan.repositoryPath
  );

  return {
    id: "typescript-check",
    category: "types",
    name: "TypeScript Check",
    status: result.status,
    command: "npx tsc --noEmit",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary:
      result.status === "passed"
        ? "TypeScript validation completed successfully."
        : "TypeScript validation failed.",
    stdout: result.stdout,
    stderr: result.stderr,
  };
}