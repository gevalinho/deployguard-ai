import { existsSync } from "node:fs";
import { join } from "node:path";

import type { CommandResult } from "@/lib/execution/command-runner";
import { runCommand } from "@/lib/execution/command-runner";

export type WorkspacePackageManager =
  | "npm"
  | "pnpm"
  | "yarn";

export interface WorkspacePreparationResult {
  status: "passed" | "failed";
  packageManager?: WorkspacePackageManager;
  command?: CommandResult;
  summary: string;
}

function detectPackageManager(
  repositoryPath: string
): WorkspacePackageManager | undefined {
  if (
    existsSync(
      join(repositoryPath, "package-lock.json")
    )
  ) {
    return "npm";
  }

  if (
    existsSync(
      join(repositoryPath, "pnpm-lock.yaml")
    )
  ) {
    return "pnpm";
  }

  if (
    existsSync(
      join(repositoryPath, "yarn.lock")
    )
  ) {
    return "yarn";
  }

  return undefined;
}

export async function prepareAssessmentWorkspace(
  repositoryPath: string
): Promise<WorkspacePreparationResult> {
  const packageManager =
    detectPackageManager(repositoryPath);

  if (!packageManager) {
    return {
      status: "failed",
      summary:
        "No supported package manager lockfile was detected.",
    };
  }

  let command: string;
  let args: string[];

  switch (packageManager) {
    case "npm":
      command = "npm";
      args = ["ci", "--ignore-scripts"];
      break;

    case "pnpm":
      command = "pnpm";
      args = [
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
      ];
      break;

    case "yarn":
      command = "yarn";
      args = [
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
      ];
      break;
  }

  const result = await runCommand(
    command,
    args,
    repositoryPath
  );

  return {
    status: result.status,
    packageManager,
    command: result,
    summary:
      result.status === "passed"
        ? `Workspace dependencies installed successfully using ${packageManager}.`
        : `Workspace dependency installation failed using ${packageManager}.`,
  };
}