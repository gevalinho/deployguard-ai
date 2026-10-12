import { readFile } from "node:fs/promises";
import { join } from "node:path";
import semver from "semver";
import { parseNpmStyleAuditReport } from "@/lib/agents/sandbox-security-agent";
import type { FixProposal } from "./types";

type RepairPlan =
  | {
      supported: true;
      packageName: string;
      version: string;
      command: string[];
    }
  | {
      supported: false;
      reason: string;
    };

export async function planDependencyRepair(
  repositoryPath: string,
  proposal: FixProposal,
  baselineAuditStdout: string,
): Promise<RepairPlan> {
  const packageName = proposal.packageName;
  const advisoryId = proposal.advisoryId;

  if (!packageName || !advisoryId || !/^[0-9]{1,20}$/.test(advisoryId)) {
    return {
      supported: false,
      reason: "A valid package name and advisory ID are required.",
    };
  }

  const findings = parseNpmStyleAuditReport(baselineAuditStdout);

  if (
    !findings ||
    findings.filter(
      (finding) =>
        finding.packageName === packageName &&
        finding.advisoryIds?.includes(advisoryId),
    ).length !== 1
  ) {
    return {
      supported: false,
      reason: "The selected advisory was not uniquely verified.",
    };
  }

  let audit: unknown;
  let manifest: unknown;
  let lockfile: unknown;

  try {
    audit = JSON.parse(baselineAuditStdout);

    manifest = JSON.parse(
      await readFile(join(repositoryPath, "package.json"), "utf8"),
    );

    lockfile = JSON.parse(
      await readFile(join(repositoryPath, "package-lock.json"), "utf8"),
    );
  } catch {
    return {
      supported: false,
      reason: "Unable to read the audit report or package manifest.",
    };
  }

  if (
    !audit ||
    typeof audit !== "object" ||
    !("vulnerabilities" in audit) ||
    !manifest ||
    typeof manifest !== "object"
  ) {
    return {
      supported: false,
      reason: "Invalid audit report or package manifest.",
    };
  }

  const vulnerabilities = audit.vulnerabilities as Record<string, unknown>;
  const vulnerability = vulnerabilities[packageName];

  if (!vulnerability || typeof vulnerability !== "object") {
    return {
      supported: false,
      reason: "Selected vulnerability is missing.",
    };
  }

  const fix = (
    vulnerability as {
      fixAvailable?:
        | {
            name?: string;
            version?: string;
            isSemVerMajor?: boolean;
          }
        | boolean;
    }
  ).fixAvailable;

  if (
    !fix ||
    typeof fix !== "object" ||
    fix.name !== packageName ||
    !fix.version ||
    !semver.valid(fix.version)
  ) {
    return {
      supported: false,
      reason: "No explicit targeted fix version is available.",
    };
  }

  const packageJson = manifest as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const isProductionDependency = Object.prototype.hasOwnProperty.call(
    packageJson.dependencies ?? {},
    packageName,
  );

  const isDevelopmentDependency = Object.prototype.hasOwnProperty.call(
    packageJson.devDependencies ?? {},
    packageName,
  );

  if (isProductionDependency === isDevelopmentDependency) {
    return {
      supported: false,
      reason: "The package must be declared in exactly one dependency section.",
    };
  }

  const dependencyType = isProductionDependency ? "production" : "development";

  const declaredVersion = isProductionDependency
    ? packageJson.dependencies?.[packageName]
    : packageJson.devDependencies?.[packageName];

  if (
    typeof declaredVersion !== "string" ||
    !semver.validRange(declaredVersion)
  ) {
    return {
      supported: false,
      reason: "The package is not a supported direct dependency.",
    };
  }

  //   const currentMinimum = semver.minVersion(declaredVersion);

  //   if (!currentMinimum) {
  //     return {
  //       supported: false,
  //       reason: "Unable to determine the current dependency version.",
  //     };
  //   }

  //   if (
  //     semver.major(currentMinimum) !== semver.major(fix.version) &&
  //     proposal.risk !== "breaking_change_allowed"
  //   ) {
  //     return {
  //       supported: false,
  //       reason: "The proposed fix requires approval for a major-version change.",
  //     };
  //   }

  const lock = lockfile as {
    lockfileVersion?: number;
    packages?: Record<string, { version?: string }>;
  };

  const installedVersion =
    lock?.packages?.[`node_modules/${packageName}`]?.version;

  if (
    lock?.lockfileVersion !== 3 ||
    typeof installedVersion !== "string" ||
    !semver.valid(installedVersion)
  ) {
    return {
      supported: false,
      reason:
        "Unable to verify the installed dependency version from npm lockfile v3.",
    };
  }

  if (!semver.satisfies(installedVersion, declaredVersion)) {
    return {
      supported: false,
      reason: "Installed dependency version does not match the manifest.",
    };
  }

  if (!semver.gt(fix.version, installedVersion)) {
    return {
      supported: false,
      reason:
        "The proposed dependency fix must be newer than the installed version.",
    };
  }

  if (
    semver.major(installedVersion) !== semver.major(fix.version) &&
    proposal.risk !== "breaking_change_allowed"
  ) {
    return {
      supported: false,
      reason: "The proposed fix requires approval for a major-version change.",
    };
  }

  return {
    supported: true,
    packageName,
    version: fix.version,
    command: [
      "npm",
      "install",
      `${packageName}@${fix.version}`,
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      dependencyType === "development" ? "--save-dev" : "--save-prod",
    ],
  };
}
