import {
  existsSync,
  readFileSync,
} from "node:fs";

import {
  join,
} from "node:path";

export type SandboxPackageManager =
  | "npm"
  | "pnpm"
  | "yarn";

export interface PackageManagerInfo {
  name: SandboxPackageManager;

  version?: string;
  majorVersion?: number;

  lockfile:
    | "package-lock.json"
    | "pnpm-lock.yaml"
    | "yarn.lock";

  declaredPackageManager?: string;

  source:
    | "lockfile"
    | "lockfile_and_package_json"
    | "lockfile_and_repository_config";

  yarnMode?:
    | "classic"
    | "modern";
}

interface PackageJsonShape {
  packageManager?: unknown;
}

function parseDeclaredPackageManager(
  repositoryPath: string
): {
  name?: SandboxPackageManager;
  version?: string;
  majorVersion?: number;
  raw?: string;
} {
  const packageJsonPath =
    join(
      repositoryPath,
      "package.json"
    );

  if (!existsSync(packageJsonPath)) {
    return {};
  }

  try {
    const packageJson =
      JSON.parse(
        readFileSync(
          packageJsonPath,
          "utf8"
        )
      ) as PackageJsonShape;

    if (
      typeof packageJson.packageManager !==
      "string"
    ) {
      return {};
    }

    const raw =
      packageJson.packageManager.trim();

    const match =
      /^(npm|pnpm|yarn)@(.+)$/.exec(
        raw
      );

    if (!match) {
      return {
        raw,
      };
    }

    const name =
      match[1] as SandboxPackageManager;

    const version =
      match[2];

    const majorMatch =
      /^(\d+)/.exec(
        version
      );

    const majorVersion =
      majorMatch
        ? Number.parseInt(
            majorMatch[1],
            10
          )
        : undefined;

    return {
      name,
      version,
      majorVersion:
        Number.isFinite(
          majorVersion
        )
          ? majorVersion
          : undefined,
      raw,
    };
  } catch {
    return {};
  }
}

function detectYarnMode(
  repositoryPath: string,
  declaredMajorVersion?: number
): "classic" | "modern" {
  if (
    declaredMajorVersion !==
    undefined
  ) {
    return declaredMajorVersion === 1
      ? "classic"
      : "modern";
  }

  const hasModernYarnConfig =
    existsSync(
      join(
        repositoryPath,
        ".yarnrc.yml"
      )
    ) ||
    existsSync(
      join(
        repositoryPath,
        ".pnp.cjs"
      )
    ) ||
    existsSync(
      join(
        repositoryPath,
        ".pnp.loader.mjs"
      )
    );

  if (hasModernYarnConfig) {
    return "modern";
  }

  /*
   * Yarn Classic repositories commonly have
   * only yarn.lock and package.json.
   *
   * When no stronger evidence exists, prefer
   * Yarn Classic rather than assuming modern
   * Yarn syntax.
   */
  return "classic";
}

export function detectPackageManager(
  repositoryPath: string
): PackageManagerInfo | undefined {
  const candidates: {
    name: SandboxPackageManager;
    lockfile:
      PackageManagerInfo["lockfile"];
  }[] = [
    {
      name: "npm",
      lockfile:
        "package-lock.json",
    },
    {
      name: "pnpm",
      lockfile:
        "pnpm-lock.yaml",
    },
    {
      name: "yarn",
      lockfile:
        "yarn.lock",
    },
  ];

  const detected =
    candidates.find(
      (candidate) =>
        existsSync(
          join(
            repositoryPath,
            candidate.lockfile
          )
        )
    );

  if (!detected) {
    return undefined;
  }

  const declared =
    parseDeclaredPackageManager(
      repositoryPath
    );

  if (
    detected.name === "yarn"
  ) {
    const declaredMatches =
      declared.name === "yarn";

    const yarnMode =
      detectYarnMode(
        repositoryPath,
        declaredMatches
          ? declared.majorVersion
          : undefined
      );

    return {
      name: "yarn",

      lockfile:
        "yarn.lock",

      version:
        declaredMatches
          ? declared.version
          : undefined,

      majorVersion:
        declaredMatches
          ? declared.majorVersion
          : yarnMode === "classic"
            ? 1
            : undefined,

      declaredPackageManager:
        declared.raw,

      yarnMode,

      source:
        declaredMatches
          ? "lockfile_and_package_json"
          : yarnMode === "modern"
            ? "lockfile_and_repository_config"
            : "lockfile",
    };
  }

  if (
    declared.name ===
    detected.name
  ) {
    return {
      name:
        detected.name,

      lockfile:
        detected.lockfile,

      version:
        declared.version,

      majorVersion:
        declared.majorVersion,

      declaredPackageManager:
        declared.raw,

      source:
        "lockfile_and_package_json",
    };
  }

  return {
    name:
      detected.name,

    lockfile:
      detected.lockfile,

    declaredPackageManager:
      declared.raw,

    source:
      "lockfile",
  };
}