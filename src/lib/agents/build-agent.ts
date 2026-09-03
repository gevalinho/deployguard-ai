import type { CheckResult } from "@/lib/checks/types";
import { runCommand } from "@/lib/execution/command-runner";
import type { RepositoryScanResult } from "@/lib/scanner/types";

function getPackageManager(
  scan: RepositoryScanResult
): string | null {
  return (
    scan.facts.find(
      (fact) => fact.key === "packageManager"
    )?.value ?? null
  );
}

export async function runBuildAgent(
  scan: RepositoryScanResult
): Promise<CheckResult> {
  const packageManager = getPackageManager(scan);

  if (!packageManager) {
    return {
      id: "production-build",
      category: "build",
      name: "Production Build",
      status: "skipped",
      summary: "No verified package manager was detected.",
    };
  }

  let command: string;
  let args: string[];

  switch (packageManager) {
    case "npm":
      command = "npm";
      args = ["run", "build"];
      break;

    case "pnpm":
      command = "pnpm";
      args = ["run", "build"];
      break;

    case "Yarn":
      command = "yarn";
      args = ["build"];
      break;

    default:
      return {
        id: "production-build",
        category: "build",
        name: "Production Build",
        status: "skipped",
        summary: `Unsupported package manager: ${packageManager}`,
      };
  }

  const result = await runCommand(
  command,
  args,
  scan.repositoryPath,
  {
    env: {
      NODE_ENV: "production",
    },
  }
);

  return {
    id: "production-build",
    category: "build",
    name: "Production Build",

    status: result.status,

    command: [command, ...args].join(" "),
    exitCode: result.exitCode,
    durationMs: result.durationMs,

    summary:
      result.status === "passed"
        ? "Production build completed successfully."
        : "Production build failed.",

    stdout: result.stdout,
    stderr: result.stderr,
  };
}