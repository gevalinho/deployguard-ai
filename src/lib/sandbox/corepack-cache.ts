import {
  mkdirSync,
} from "node:fs";

import {
  resolve,
} from "node:path";

import type {
  PackageManagerInfo,
} from "@/lib/sandbox/package-manager";

import type {
  DockerSandboxMount,
} from "@/lib/sandbox/docker-sandbox";

const COREPACK_CACHE_HOST_PATH =
  resolve(
    process.cwd(),
    ".deployguard",
    "cache",
    "corepack"
  );

const COREPACK_CACHE_CONTAINER_PATH =
  "/deployguard-cache/corepack";

export interface CorepackSandboxConfig {
  environment: Record<string, string>;
  mounts: DockerSandboxMount[];
}

export function getCorepackSandboxConfig(
  packageManager: PackageManagerInfo,
  readOnly: boolean
): CorepackSandboxConfig {
  /*
   * npm ships directly with the Node runtime
   * image and does not require Corepack.
   */
  if (packageManager.name === "npm") {
    return {
      environment: {},
      mounts: [],
    };
  }

  mkdirSync(
    COREPACK_CACHE_HOST_PATH,
    {
      recursive: true,
    }
  );

  return {
    environment: {
      COREPACK_HOME:
        COREPACK_CACHE_CONTAINER_PATH,
    },

    mounts: [
      {
        source:
          COREPACK_CACHE_HOST_PATH,

        target:
          COREPACK_CACHE_CONTAINER_PATH,

        readOnly,
      },
    ],
  };
}