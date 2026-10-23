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
  compatibilityError?: string;
  compatibilityKind?: "repository" | "capability";

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

const PNPM_FALLBACK: Record<string, string> = {
  "6.0": "8.15.9",
  "9.0": "9.15.9",
};

function resolvePnpm(repositoryPath: string, declared: ReturnType<typeof parseDeclaredPackageManager>):
  Pick<PackageManagerInfo, "version" | "majorVersion" | "compatibilityError" | "compatibilityKind"> {
  const lock = readFileSync(join(repositoryPath, "pnpm-lock.yaml"), "utf8");
  const match = /^lockfileVersion:\s*['"]?(\d+(?:\.\d+)?)['"]?\s*$/m.exec(lock);
  if (!match) return { compatibilityKind: "repository", compatibilityError:
    "pnpm-lock.yaml has no valid lockfileVersion. Declare a supported lockfile and an exact pnpm packageManager version." };
  const format = match[1].includes(".") ? match[1] : `${match[1]}.0`;
  const fallback = format.startsWith("9.") ? PNPM_FALLBACK["9.0"] : PNPM_FALLBACK[format];
  if (!fallback) return { compatibilityKind: "capability", compatibilityError:
    `DeployGuard does not support pnpm lockfileVersion ${format}. Supported formats are 6.0 and 9.x; use a supported lockfile format or request DeployGuard support.` };
  if (declared.raw !== undefined) {
    if (declared.name !== "pnpm" || !declared.version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+sha(?:224|256|512)\.[a-fA-F0-9]+)?$/.test(declared.version))
      return { compatibilityKind: "repository", compatibilityError:
        `pnpm-lock.yaml uses lockfileVersion ${format}, but package.json.packageManager must be an exact pnpm@major.minor.patch version (found ${JSON.stringify(declared.raw)}).` };
    const major = Number(declared.version.split(".")[0]);
    if (format === "6.0" ? major !== 8 : major < 9 || major > 12)
      return { compatibilityKind: "repository", compatibilityError:
        `pnpm-lock.yaml uses lockfileVersion ${format}, incompatible with package.json.packageManager ${declared.raw}. Use a compatible exact pnpm version or regenerate the lockfile in the repository.` };
    return { version: declared.version, majorVersion: major };
  }
  return { version: fallback, majorVersion: Number(fallback.split(".")[0]) };
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
      return Object.prototype.hasOwnProperty.call(packageJson, "packageManager")
        ? { raw: JSON.stringify(packageJson.packageManager) ?? String(packageJson.packageManager) }
        : {};
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

  if (detected.name === "pnpm") {
    return {
      name: "pnpm", lockfile: "pnpm-lock.yaml", declaredPackageManager: declared.raw,
      source: declared.raw === undefined ? "lockfile" : "lockfile_and_package_json",
      ...resolvePnpm(repositoryPath, declared),
    };
  }

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
