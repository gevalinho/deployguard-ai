import {
  createHash,
} from "node:crypto";

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";

import {
  basename,
  join,
  resolve,
} from "node:path";

import {
  spawnSync,
} from "node:child_process";

export const DEPENDENCY_CACHE_VERSION =
  "v2";

export const SANDBOX_RUNTIME_IMAGE =
  "node:22-bookworm-slim";

export interface DependencyCacheIdentity {
  key: string;
  packageManager: string;
  runtimeImage: string;
}

function readRequiredFile(
  filePath: string
): Buffer {
  if (!existsSync(filePath)) {
    throw new Error(
      `Dependency cache input is missing: ${basename(filePath)}`
    );
  }

  return readFileSync(filePath);
}

export function createDependencyCacheIdentity(
  repositoryPath: string,
  packageManager: string
): DependencyCacheIdentity {
  const packageJsonPath =
    join(
      repositoryPath,
      "package.json"
    );

  const lockfileName =
    packageManager === "npm"
      ? "package-lock.json"
      : packageManager === "pnpm"
        ? "pnpm-lock.yaml"
        : "yarn.lock";

  const lockfilePath =
    join(
      repositoryPath,
      lockfileName
    );

  const hash =
    createHash("sha256");

  hash.update(
    DEPENDENCY_CACHE_VERSION
  );

  hash.update("\0");

  hash.update(
    packageManager
  );

  hash.update("\0");

  hash.update(
    SANDBOX_RUNTIME_IMAGE
  );

  hash.update("\0");

  hash.update(
    readRequiredFile(
      packageJsonPath
    )
  );

  hash.update("\0");

  hash.update(
    readRequiredFile(
      lockfilePath
    )
  );

  return {
    key:
      hash.digest("hex"),

    packageManager,

    runtimeImage:
      SANDBOX_RUNTIME_IMAGE,
  };
}

function getDependencyCacheRoot(): string {
  return resolve(
    process.cwd(),
    ".deployguard",
    "cache",
    "dependencies"
  );
}

function getDependencyCacheDirectory(
  key: string
): string {
  return join(
    getDependencyCacheRoot(),
    key
  );
}

function getDependencyCachePath(
  key: string
): string {
  return join(
    getDependencyCacheDirectory(
      key
    ),
    "node_modules.tar"
  );
}

export function hasDependencyCache(
  key: string
): boolean {
  return existsSync(
    getDependencyCachePath(
      key
    )
  );
}

export function restoreDependencyCache(
  key: string,
  repositoryPath: string
): boolean {
  const archivePath =
    getDependencyCachePath(
      key
    );

  if (!existsSync(archivePath)) {
    return false;
  }

  const destination =
    join(
      repositoryPath,
      "node_modules"
    );

  rmSync(
    destination,
    {
      recursive: true,
      force: true,
    }
  );

  const result =
    spawnSync(
      "tar",
      [
        "-xf",
        archivePath,
        "-C",
        repositoryPath,
      ],
      {
        encoding:
          "utf8",

        timeout:
          2 * 60 * 1000,
      }
    );

  if (
    result.error ||
    result.status !== 0
  ) {
    console.warn(
      "[Dependency Cache] Cached archive could not be extracted. Removing invalid cache entry."
    );

    rmSync(
      archivePath,
      {
        force: true,
      }
    );

    rmSync(
      destination,
      {
        recursive: true,
        force: true,
      }
    );

    return false;
  }

  return existsSync(
    destination
  );
}

export function saveDependencyCache(
  key: string,
  repositoryPath: string
): boolean {
  const source =
    join(
      repositoryPath,
      "node_modules"
    );

  if (!existsSync(source)) {
    return false;
  }

  const cacheDirectory =
    getDependencyCacheDirectory(
      key
    );

  mkdirSync(
    cacheDirectory,
    {
      recursive: true,
    }
  );

  const destination =
    getDependencyCachePath(
      key
    );

  const temporaryArchive =
    join(
      cacheDirectory,
      `node_modules-${process.pid}-${Date.now()}.tar`
    );

  const result =
    spawnSync(
      "tar",
      [
        "-cf",
        temporaryArchive,
        "-C",
        repositoryPath,
        "node_modules",
      ],
      {
        encoding:
          "utf8",

        timeout:
          2 * 60 * 1000,
      }
    );

  if (
    result.error ||
    result.status !== 0
  ) {
    rmSync(
      temporaryArchive,
      {
        force: true,
      }
    );

    return false;
  }

  /*
   * Publish the completed archive only after
   * tar has successfully finished writing it.
   *
   * This prevents incomplete cache entries
   * from being treated as valid.
   */
  rmSync(
    destination,
    {
      force: true,
    }
  );

  renameSync(
    temporaryArchive,
    destination
  );

  return true;
}