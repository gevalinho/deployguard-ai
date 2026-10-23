import type {
  PackageManagerInfo,
} from "@/lib/sandbox/package-manager";

export interface PackageManagerCommand {
  command: string[];
  display: string;
}

export function createRunScriptCommand(
  packageManager: PackageManagerInfo,
  script: string
): PackageManagerCommand {
  switch (packageManager.name) {
    case "npm":
      return {
        command: [
          "npm",
          "run",
          script,
        ],
        display:
          `npm run ${script}`,
      };

    case "pnpm":
      return {
        command: [
          "corepack",
          packageManager.version ? `pnpm@${packageManager.version}` : "pnpm",
          "run",
          script,
        ],
        display:
          `pnpm run ${script}`,
      };

    case "yarn":
      return {
        command: [
          "corepack",
          "yarn",
          "run",
          script,
        ],
        display:
          `yarn run ${script}`,
      };
  }
}

export function createExecCommand(
  packageManager: PackageManagerInfo,
  executable: string,
  args: string[] = []
): PackageManagerCommand {
  switch (packageManager.name) {
    case "npm":
      return {
        command: [
          "npm",
          "exec",
          "--",
          executable,
          ...args,
        ],
        display: [
          "npm exec --",
          executable,
          ...args,
        ].join(" "),
      };

    case "pnpm":
      return {
        command: [
          "corepack",
          packageManager.version ? `pnpm@${packageManager.version}` : "pnpm",
          "exec",
          executable,
          ...args,
        ],
        display: [
          "pnpm exec",
          executable,
          ...args,
        ].join(" "),
      };

    case "yarn":
  return {
    command: [
      "corepack",
      "yarn",
      "run",
      executable,
      ...args,
    ],
    display: [
      "yarn run",
      executable,
      ...args,
    ].join(" "),
  };
  }
}

/**
 * Optional production-only security audit.
 *
 * This supplements the full audit; it must never replace it.
 * Unsupported package managers return null rather than
 * assuming their audit flags behave like npm's.
 */
export function createProductionAuditCommand(
  packageManager: PackageManagerInfo
): PackageManagerCommand | null {
  if (packageManager.name !== "npm") {
    return null;
  }

  return {
    command: [
      "npm",
      "audit",
      "--omit=dev",
      "--audit-level=high",
      "--json",
    ],
    display:
      "npm audit --omit=dev --audit-level=high --json",
  };
}

export function createAuditCommand(
  packageManager: PackageManagerInfo
): PackageManagerCommand {
  switch (packageManager.name) {
    case "npm":
      return {
        command: [
          "npm",
          "audit",
          "--audit-level=high",
          "--json",
        ],
        display:
          "npm audit --audit-level=high --json",
      };

    case "pnpm":
      return {
        command: [
          "corepack",
          packageManager.version ? `pnpm@${packageManager.version}` : "pnpm",
          "audit",
          "--audit-level",
          "high",
          "--json",
        ],
        display:
          "pnpm audit --audit-level high --json",
      };

    case "yarn":
      if (
        packageManager.yarnMode ===
        "classic"
      ) {
        return {
          command: [
            "corepack",
            "yarn",
            "audit",
            "--level",
            "high",
            "--json",
          ],
          display:
            "yarn audit --level high --json",
        };
      }

      return {
        command: [
          "corepack",
          "yarn",
          "npm",
          "audit",
          "--severity",
          "high",
          "--recursive",
          "--json",
        ],
        display:
          "yarn npm audit --severity high --recursive --json",
      };
  }
}
