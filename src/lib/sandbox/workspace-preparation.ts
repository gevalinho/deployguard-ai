import {
  mkdirSync,
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

export interface SandboxPreparationResult {
  status:
    | "passed"
    | "failed"
    | "timed_out";

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
        "pnpm",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
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
  ];
  }
}

function detectNetworkFailure(
  stdout: string,
  stderr: string
): boolean {
  const combinedOutput =
    `${stdout}\n${stderr}`;

  return /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network aborted|network connectivity/i.test(
    combinedOutput
  );
}

export async function prepareSandboxWorkspace(
  repositoryPath: string
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
          restoreDependencyCache(
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

  const command =
  createPreparationCommand(
    packageManager
  );

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
        2,

      timeoutMs:
        10 *
        60 *
        1000,
    },
  });

  console.log(
    `[Dependency Cache] Package installation completed in ${((Date.now() - installStartedAt) / 1000).toFixed(2)}s with status: ${result.status}.`
  );

  if (
    result.status === "passed" &&
    dependencyCacheKey
  ) {
    try {
      const saveStartedAt =
        Date.now();

      const saved =
        saveDependencyCache(
          dependencyCacheKey,
          repositoryPath
        );

      console.log(
        saved
          ? `[Dependency Cache] Saved in ${((Date.now() - saveStartedAt) / 1000).toFixed(2)}s.`
          : "[Dependency Cache] No node_modules directory was available to cache."
      );
    } catch (error) {
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

    summary:
      result.status ===
      "passed"
        ? `Sandbox workspace prepared successfully using ${packageManager.name}.`
        : networkFailure
          ? "Sandbox workspace preparation could not complete because of a package registry or network error."
          : `Sandbox workspace preparation failed using ${packageManager.name}.`,
  };
}