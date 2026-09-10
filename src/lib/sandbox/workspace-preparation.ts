// import {
//   existsSync,
//   mkdirSync,
// } from "node:fs";

// import {
//   join,
//   resolve,
// } from "node:path";

// import {
//   runDockerSandboxCommand,
// } from "@/lib/sandbox/docker-sandbox";

// export type SandboxPackageManager =
//   | "npm"
//   | "pnpm"
//   | "yarn";

// export interface SandboxPreparationResult {
//   status:
//     | "passed"
//     | "failed"
//     | "timed_out";

//   packageManager?: SandboxPackageManager;

//   stdout: string;
//   stderr: string;
//   durationMs: number;

//   summary: string;
// }

// function detectPackageManager(
//   repositoryPath: string
// ): SandboxPackageManager | undefined {
//   if (
//     existsSync(
//       join(
//         repositoryPath,
//         "package-lock.json"
//       )
//     )
//   ) {
//     return "npm";
//   }

//   if (
//     existsSync(
//       join(
//         repositoryPath,
//         "pnpm-lock.yaml"
//       )
//     )
//   ) {
//     return "pnpm";
//   }

//   if (
//     existsSync(
//       join(
//         repositoryPath,
//         "yarn.lock"
//       )
//     )
//   ) {
//     return "yarn";
//   }

//   return undefined;
// }

// function createPreparationCommand(
//   packageManager: SandboxPackageManager
// ): string[] {
//   switch (packageManager) {
//     case "npm":
//       return [
//         "sh",
//         "-c",
//         [
//           "mkdir -p /tmp/deployguard-home",
//           "&&",
//           "npm ci",
//           "--ignore-scripts",
//           "--no-audit",
//           "--no-fund",
//           "--prefer-offline",
//         ].join(" "),
//       ];

//     case "pnpm":
//       return [
//         "corepack",
//         "pnpm",
//         "install",
//         "--frozen-lockfile",
//         "--ignore-scripts",
//       ];

//     case "yarn":
//       return [
//         "corepack",
//         "yarn",
//         "install",
//         "--frozen-lockfile",
//         "--ignore-scripts",
//       ];
//   }
// }

// function detectNetworkFailure(
//   stdout: string,
//   stderr: string
// ): boolean {
//   const combinedOutput =
//     `${stdout}\n${stderr}`;

//   return /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network aborted|network connectivity/i.test(
//     combinedOutput
//   );
// }

// export async function prepareSandboxWorkspace(
//   repositoryPath: string
// ): Promise<SandboxPreparationResult> {
//   const packageManager =
//     detectPackageManager(
//       repositoryPath
//     );

//   if (!packageManager) {
//     return {
//       status: "failed",
//       stdout: "",
//       stderr: "",
//       durationMs: 0,
//       summary:
//         "No supported package manager lockfile was detected.",
//     };
//   }

//   const cacheRoot =
//     resolve(
//       process.cwd(),
//       ".deployguard",
//       "cache"
//     );

//   const npmCachePath =
//     join(
//       cacheRoot,
//       "npm"
//     );

//   if (
//     packageManager === "npm"
//   ) {
//     mkdirSync(
//       npmCachePath,
//       {
//         recursive: true,
//       }
//     );
//   }

//   const uid =
//     typeof process.getuid ===
//     "function"
//       ? process.getuid()
//       : 1000;

//   const gid =
//     typeof process.getgid ===
//     "function"
//       ? process.getgid()
//       : 1000;

//   const command =
//     createPreparationCommand(
//       packageManager
//     );

//   const mounts =
//     packageManager === "npm"
//       ? [
//           {
//             source:
//               npmCachePath,

//             target:
//               "/deployguard-cache/npm",
//           },
//         ]
//       : [];

//   const result =
//     await runDockerSandboxCommand({
//       repositoryPath,

//       command,

//       network:
//         "bridge",

//       mounts,

//       user:
//         `${uid}:${gid}`,

//       environment: {
//         HOME:
//           "/tmp/deployguard-home",

//         npm_config_cache:
//           "/deployguard-cache/npm",

//         CI:
//           "true",
//       },

//       limits: {
//         memoryMb: 2048,
//         cpus: 2,
//         timeoutMs:
//           10 *
//           60 *
//           1000,
//       },
//     });

//   const networkFailure =
//     detectNetworkFailure(
//       result.stdout,
//       result.stderr
//     );

//   return {
//     status:
//       result.status,

//     packageManager,

//     stdout:
//       result.stdout,

//     stderr:
//       result.stderr,

//     durationMs:
//       result.durationMs,

//     summary:
//       result.status ===
//       "passed"
//         ? `Sandbox workspace prepared successfully using ${packageManager}.`
//         : networkFailure
//           ? "Sandbox workspace preparation could not complete because of a package registry or network error."
//           : `Sandbox workspace preparation failed using ${packageManager}.`,
//   };
// }



import {
  existsSync,
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
  runDockerSandboxCommand,
} from "@/lib/sandbox/docker-sandbox";

export type SandboxPackageManager =
  | "npm"
  | "pnpm"
  | "yarn";

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

function detectPackageManager(
  repositoryPath: string
): SandboxPackageManager | undefined {
  if (
    existsSync(
      join(
        repositoryPath,
        "package-lock.json"
      )
    )
  ) {
    return "npm";
  }

  if (
    existsSync(
      join(
        repositoryPath,
        "pnpm-lock.yaml"
      )
    )
  ) {
    return "pnpm";
  }

  if (
    existsSync(
      join(
        repositoryPath,
        "yarn.lock"
      )
    )
  ) {
    return "yarn";
  }

  return undefined;
}

function createPreparationCommand(
  packageManager: SandboxPackageManager
): string[] {
  switch (packageManager) {
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
      return [
        "corepack",
        "yarn",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
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

  let dependencyCacheKey:
    string | undefined;

  try {
    const identity =
      createDependencyCacheIdentity(
        repositoryPath,
        packageManager
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
          packageManager,
          stdout: "",
          stderr: "",
          durationMs:
            Date.now() -
            preparationStartedAt,
          summary:
            `Sandbox workspace prepared from dependency cache using ${packageManager}.`,
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
    packageManager === "npm"
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

  const mounts =
    packageManager === "npm"
      ? [
          {
            source:
              npmCachePath,

            target:
              "/deployguard-cache/npm",
          },
        ]
      : [];

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

      environment: {
        HOME:
          "/tmp/deployguard-home",

        npm_config_cache:
          "/deployguard-cache/npm",

        CI:
          "true",
      },

      limits: {
        memoryMb: 2048,
        cpus: 2,
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

    packageManager,

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
        ? `Sandbox workspace prepared successfully using ${packageManager}.`
        : networkFailure
          ? "Sandbox workspace preparation could not complete because of a package registry or network error."
          : `Sandbox workspace preparation failed using ${packageManager}.`,
  };
}