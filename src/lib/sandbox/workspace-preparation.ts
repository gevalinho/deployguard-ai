import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";

import {
  join,
  resolve,
} from "node:path";

import {
  createDependencyCacheIdentity,
  hasDependencyCache,
  restoreDependencyCache,
  saveDependencyCache,
} from "@/lib/sandbox/dependency-cache";

import {
  detectPackageManager,
  type PackageManagerInfo,
  type SandboxPackageManager,
} from "@/lib/sandbox/package-manager";

import {
  runDockerSandboxCommand,
} from "@/lib/sandbox/docker-sandbox";

import {
  getCorepackSandboxConfig,
} from "@/lib/sandbox/corepack-cache";

import type {
  PreparationPlan,
} from "@/lib/sandbox/preparation-planner";
import { CommandTerminationUnconfirmedError } from "@/lib/execution/command-runner";

export const DEPENDENCY_PREPARATION_TIMEOUT_MS = 5 * 60 * 1000;
const PNPM_STORE_NAME = ".deployguard-pnpm-store";
const PNPM_STORE_CONTAINER_PATH = `/workspace/${PNPM_STORE_NAME}`;

function ensureWorkspacePnpmStore(repositoryPath: string): void {
  const workspace = lstatSync(repositoryPath);
  if (!workspace.isDirectory() || workspace.isSymbolicLink())
    throw new Error("The pnpm workspace must be a real directory.");
  const storePath = join(realpathSync(repositoryPath), PNPM_STORE_NAME);
  if (!existsSync(storePath)) mkdirSync(storePath, { mode: 0o700 });
  const store = lstatSync(storePath);
  if (!store.isDirectory() || store.isSymbolicLink() || store.uid !== process.getuid?.() ||
      store.dev !== workspace.dev || (store.mode & 0o022) !== 0 ||
      realpathSync(storePath) !== join(realpathSync(repositoryPath), PNPM_STORE_NAME))
    throw new Error("The pnpm store path is unsafe; it must be a private directory inside the disposable workspace.");
  const mountPaths = readFileSync("/proc/self/mountinfo", "utf8").split("\n").map((line) => {
    const encoded = line.split(" ")[4];
    return encoded?.replace(/\\([0-7]{3})/g, (_, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8)));
  });
  if (mountPaths.some((path) => path === storePath || path?.startsWith(`${storePath}/`)))
    throw new Error("The pnpm store path contains a host mount and cannot be used safely.");
}

export interface SandboxPreparationResult {
  status:
    | "passed"
    | "failed"
    | "timed_out"
    | "infrastructure_error";

  failureKind?:
    | "network"
    | "capacity"
    | "timeout"
    | "infrastructure"
    | "repository"
    | "capability";

  packageManager?: SandboxPackageManager;

  stdout: string;
  stderr: string;
  durationMs: number;

  summary: string;
}

function createPreparationCommand(
  packageManager: PackageManagerInfo
): string[] {
  switch (packageManager.name) {
    case "npm":
      return [
        "sh",
        "-c",
        [
          "mkdir -p /tmp/deployguard-home",
          "&&",
          "npm ci",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--prefer-offline",
        ].join(" "),
      ];

    case "pnpm":
      return [
        "corepack",
        packageManager.version ? `pnpm@${packageManager.version}` : "pnpm",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--store-dir",
        PNPM_STORE_CONTAINER_PATH,
      ];

    case "yarn":
  if (
    packageManager.yarnMode === "classic"
  ) {
    return [
      "corepack",
      "yarn",
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
    ];
  }

  return [
    "corepack",
    "yarn",
    "install",
    "--immutable",
    packageManager.majorVersion === 2 ? "--skip-builds" : "--mode=skip-build",
  ];
  }
}

function detectNetworkFailure(
  stdout: string,
  stderr: string
): boolean {
  const combinedOutput =
    `${stdout}\n${stderr}`;

  return /ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|ECONNREFUSED|socket hang up|network aborted|network connectivity|(?:HTTP|status|response)\s*[:=]?\s*(?:429|5\d\d)\b|\bE(?:429|5\d\d)\b|ERR_PNPM_FETCH_(?:429|5\d\d)/i.test(
    combinedOutput
  );
}

function extractPreparationFailureSummary(
  stdout: string,
  stderr: string
): string | null {
  const combinedOutput =
    `${stdout}\n${stderr}`;

  const lines =
    combinedOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const peerConflictLine =
    lines.find((line) =>
      /ERESOLVE|unable to resolve dependency tree|peer dependency/i.test(
        line
      )
    );

  if (peerConflictLine) {
    return (
      "Dependency installation failed because the repository has an unresolved dependency or peer-dependency conflict."
    );
  }

  const lockfileLine =
    lines.find((line) =>
      /package-lock.*package\.json|npm ci.*lockfile|lock file/i.test(
        line
      )
    );

  if (lockfileLine) {
    return (
      "Dependency installation failed because the lockfile is not consistent with package.json."
    );
  }

  const permissionLine =
    lines.find((line) =>
      /EACCES|permission denied/i.test(
        line
      )
    );

  if (permissionLine) {
    return (
      "Dependency installation failed because the sandbox encountered a filesystem permission error."
    );
  }

  return null;
}

export async function prepareSandboxWorkspace(
  repositoryPath: string,
  preparationPlan?: PreparationPlan
): Promise<SandboxPreparationResult> {
  const preparationStartedAt =
    Date.now();

  const packageManager =
    detectPackageManager(
      repositoryPath
    );

  if (!packageManager) {
    return {
      status: "failed",
      stdout: "",
      stderr: "",
      durationMs: 0,
      summary:
        "No supported package manager lockfile was detected.",
    };
  }

  if (packageManager.compatibilityError) {
    return {
      status: "failed", failureKind: packageManager.compatibilityKind ?? "repository",
      packageManager: packageManager.name, stdout: "", stderr: "", durationMs: Date.now() - preparationStartedAt,
      summary: packageManager.compatibilityError,
    };
  }

  if (packageManager.name === "pnpm") {
    try {
      ensureWorkspacePnpmStore(repositoryPath);
    } catch (error) {
      return {
        status: "failed", failureKind: "infrastructure", packageManager: "pnpm",
        stdout: "", stderr: "", durationMs: Date.now() - preparationStartedAt,
        summary: `Sandbox pnpm store could not be prepared safely: ${error instanceof Error ? error.message : "unknown error"}`,
      };
    }
  }

  if (packageManager.name === "yarn" && existsSync(join(repositoryPath, ".yarnrc.yml")) &&
      /^\s*["']?yarnPath["']?\s*:/m.test(readFileSync(join(repositoryPath, ".yarnrc.yml"), "utf8"))) {
    return {
      status: "failed", failureKind: "repository", packageManager: "yarn",
      stdout: "", stderr: "", durationMs: Date.now() - preparationStartedAt,
      summary: "Repository .yarnrc.yml sets yarnPath to a repository-supplied executable. DeployGuard does not support this override; remove yarnPath and declare an exact Yarn version in package.json.packageManager.",
    };
  }

  /*
 * Modern Yarn requires a known package-manager
 * version so Corepack can select the correct
 * Yarn generation.
 *
 * A .yarnrc.yml or PnP file can tell us that
 * the repository is modern Yarn, but it does
 * not reliably tell us which Yarn version
 * should be executed.
 *
 * Do not silently fall back to Corepack's
 * default Yarn Classic version.
 */
if (
  packageManager.name === "yarn" &&
  packageManager.yarnMode === "modern" &&
  packageManager.majorVersion === undefined
) {
  return {
    status: "failed",
    packageManager:
      packageManager.name,
    stdout: "",
    stderr: "",
    durationMs:
      Date.now() -
      preparationStartedAt,
    summary:
      "Modern Yarn was detected, but no Yarn version is declared in package.json.packageManager. DeployGuard will not guess a Yarn version for deterministic execution.",
  };
}

  const corepackConfig =
  getCorepackSandboxConfig(
    packageManager,
    false
  ); 

  /*
   * The dependency artifact cache is currently
   * verified only for npm node_modules layouts.
   *
   * pnpm and Yarn repositories remain fully
   * assessable, but use normal installation
   * until their cache layouts are tested.
   */
  const dependencyArtifactCacheEnabled =
    packageManager.name === "npm";

  let dependencyCacheKey:
    string | undefined;

  if (
    dependencyArtifactCacheEnabled
  ) {
    try {
      const identity =
        createDependencyCacheIdentity(
          repositoryPath,
          packageManager.name
        );

      dependencyCacheKey =
        identity.key;

      if (
        hasDependencyCache(
          dependencyCacheKey
        )
      ) {
        const restoreStartedAt =
          Date.now();

        console.log(
          `[Dependency Cache] Hit: ${dependencyCacheKey.slice(0, 12)}`
        );

        const restored =
          await restoreDependencyCache(
            dependencyCacheKey,
            repositoryPath
          );

        const restoreDurationMs =
          Date.now() -
          restoreStartedAt;

        if (restored) {
          console.log(
            `[Dependency Cache] Restored in ${(restoreDurationMs / 1000).toFixed(2)}s.`
          );

          return {
            status: "passed",
            packageManager:
              packageManager.name,
            stdout: "",
            stderr: "",
            durationMs:
              Date.now() -
              preparationStartedAt,
            summary:
              `Sandbox workspace prepared from dependency cache using ${packageManager.name}.`,
          };
        }

        console.warn(
          "[Dependency Cache] Cache entry existed but could not be restored. Falling back to package installation."
        );
      } else {
        console.log(
          `[Dependency Cache] Miss: ${dependencyCacheKey.slice(0, 12)}`
        );
      }
    } catch (error) {
      if (error instanceof CommandTerminationUnconfirmedError) throw error;
      console.warn(
        "[Dependency Cache] Cache lookup failed. Falling back to package installation.",
        error instanceof Error
          ? error.message
          : "Unknown cache error"
      );
    }
  } else {
    console.log(
      `[Dependency Cache] Artifact caching not enabled for ${packageManager.name}; using normal installation.`
    );
  }

  const cacheRoot =
    resolve(
      process.cwd(),
      ".deployguard",
      "cache"
    );

  const npmCachePath =
    join(
      cacheRoot,
      "npm"
    );

  if (
    packageManager.name === "npm"
  ) {
    mkdirSync(
      npmCachePath,
      {
        recursive: true,
      }
    );
  }

  const uid =
    typeof process.getuid ===
    "function"
      ? process.getuid()
      : 1000;

  const gid =
    typeof process.getgid ===
    "function"
      ? process.getgid()
      : 1000;

  const baseCommand =
    createPreparationCommand(
      packageManager
    );

  /*
   * Artifact generation decisions belong to the
   * preparation planner. Keep the executor focused
   * on controlled execution.
   *
   * The filesystem fallback preserves compatibility
   * for callers that have not yet been migrated to
   * provide a preparation plan.
   */
  const requiresPrismaGeneration =
    preparationPlan
      ? preparationPlan.requirements.some(
          (requirement) =>
            requirement.kind ===
              "artifact_generation" &&
            requirement.technology ===
              "Prisma" &&
            requirement.required
        )
      : existsSync(
          join(
            repositoryPath,
            "prisma",
            "schema.prisma"
          )
        );

  /*
   * Dependency installation intentionally disables
   * arbitrary lifecycle scripts.
   *
   * Prisma generation is a recognized deterministic
   * preparation step. Run it explicitly while the
   * controlled preparation sandbox still has network
   * access so platform-specific Prisma binaries can be
   * obtained before later validation becomes offline.
   */
  const command =
    requiresPrismaGeneration
      ? [
          "sh",
          "-c",
          [
            baseCommand
              .map((part) =>
                `'${part.replace(/'/g, `'\\''`)}'`
              )
              .join(" "),
            "&&",
            "DATABASE_URL='postgresql://deployguard:deployguard@localhost:5432/deployguard'",
            packageManager.name === "npm"
              ? "npm exec -- prisma generate"
              : packageManager.name === "pnpm"
                ? `corepack pnpm@${packageManager.version} exec prisma generate`
                : "corepack yarn run prisma generate",
          ].join(" "),
        ]
      : baseCommand;

const mounts = [
  // ...(packageManager.name === "npm"
  //   ? [
  //       {
  //         source:
  //           npmCachePath,
  //         target:
  //           "/deployguard-cache/npm",
  //       },
  //     ]
  //   : []),


    ...(packageManager.name === "npm"
    ? [
        {
          source: npmCachePath,
          target: "/deployguard-cache/npm",
        },
      ]
    : []),

  ...corepackConfig.mounts,
];

const installStartedAt =
  Date.now();

const result =
  await runDockerSandboxCommand({
    repositoryPath,

    command,

    network:
      "bridge",

    mounts,

    user:
      `${uid}:${gid}`,

    // environment: {
    //   HOME:
    //     "/tmp/deployguard-home",

    //   CI:
    //     "true",

    //   ...corepackConfig.environment,

    //   ...(packageManager.name === "npm"
    //     ? {
    //         npm_config_cache:
    //           "/deployguard-cache/npm",
    //       }
    //     : {}),

    //   ...(packageManager.name ===
    //     "yarn" &&
    //   packageManager.yarnMode ===
    //     "modern"
    //     ? {
    //         YARN_ENABLE_SCRIPTS:
    //           "false",
    //       }
    //     : {}),
    // },

    environment: {
  HOME: "/tmp/deployguard-home",
  CI: "true",

  ...corepackConfig.environment,

  ...(packageManager.name === "npm"
    ? {
        npm_config_cache:
          "/deployguard-cache/npm",
      }
    : {}),

  ...(packageManager.name === "yarn" &&
  packageManager.yarnMode === "modern"
    ? {
        YARN_ENABLE_SCRIPTS: "false",
        YARN_ENABLE_GLOBAL_CACHE: "false",
      }
    : {}),
},

    limits: {
      memoryMb:
        2048,

      cpus:
        1,

      timeoutMs: DEPENDENCY_PREPARATION_TIMEOUT_MS,
    },
  });

  console.log(
    `[Dependency Cache] Package installation completed in ${((Date.now() - installStartedAt) / 1000).toFixed(2)}s with status: ${result.status}.`
  );


  if (result.status !== "passed") {
  console.error(
    "[Sandbox Preparation] Installation failure diagnostics:"
  );

  console.error(
    `Exit code: ${result.exitCode}`
  );

  if (result.stdout.trim()) {
    console.error(
      `STDOUT:\n${result.stdout}`
    );
  }

  if (result.stderr.trim()) {
    console.error(
      `STDERR:\n${result.stderr}`
    );
  }
}

  if (
    result.status === "passed" &&
    dependencyCacheKey
  ) {
    try {
      const saveStartedAt =
        Date.now();

      const saved =
        await saveDependencyCache(
          dependencyCacheKey,
          repositoryPath
        );

      console.log(
        saved
          ? `[Dependency Cache] Saved in ${((Date.now() - saveStartedAt) / 1000).toFixed(2)}s.`
          : "[Dependency Cache] No node_modules directory was available to cache."
      );
    } catch (error) {
      if (error instanceof CommandTerminationUnconfirmedError) throw error;
      console.warn(
        "[Dependency Cache] Cache save failed. Assessment will continue normally.",
        error instanceof Error
          ? error.message
          : "Unknown cache error"
      );
    }
  }

  const networkFailure =
    detectNetworkFailure(
      result.stdout,
      result.stderr
    );
  const capacityFailure = /\b(?:ERR_PNPM_ENOSPC|ENOSPC|no space left on device)\b/i.test(`${result.stdout}\n${result.stderr}`);

    const preparationFailureSummary =
  result.status === "passed"
    ? null
    : extractPreparationFailureSummary(
        result.stdout,
        result.stderr
      );

  return {
    status:
      result.status,

    packageManager:
      packageManager.name,

    stdout:
      result.stdout,

    stderr:
      result.stderr,

    durationMs:
      Date.now() -
      preparationStartedAt,

    failureKind:
      result.status === "passed"
        ? undefined
        : result.status === "timed_out"
          ? "timeout"
          : result.status === "infrastructure_error"
            ? "infrastructure"
            : capacityFailure
            ? "capacity"
            : networkFailure
            ? "network"
            : "repository",

    summary:
      result.status === "passed"
        ? `Sandbox workspace prepared successfully using ${packageManager.name}.`
        : result.status === "timed_out"
          ? `Sandbox workspace preparation timed out after ${DEPENDENCY_PREPARATION_TIMEOUT_MS / 1000} seconds while installing dependencies with ${packageManager.name}.`
          : result.status === "infrastructure_error"
            ? "Sandbox workspace preparation could not complete because Docker infrastructure was unavailable."
            : capacityFailure
            ? "Sandbox workspace preparation was blocked because the sandbox ran out of storage while installing dependencies."
            : networkFailure
            ? "Sandbox workspace preparation could not complete because of a package registry or network error."
            : preparationFailureSummary ??
              `Sandbox workspace preparation failed using ${packageManager.name}.`,
  };
}
