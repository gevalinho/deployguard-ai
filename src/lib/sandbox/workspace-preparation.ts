import {
  existsSync,
  mkdirSync,
} from "node:fs";

import {
  join,
  resolve,
} from "node:path";

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

export async function prepareSandboxWorkspace(
  repositoryPath: string
): Promise<SandboxPreparationResult> {
  const packageManager =
    detectPackageManager(
      repositoryPath


          );

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

mkdirSync(
  npmCachePath,
  {
    recursive: true,
  }
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

  let command: string[];

  switch (packageManager) {
  
    case "npm":
  command = [
    "sh",
    "-c",
    [
      "mkdir -p",
      "/tmp/deployguard-home",
      "&&",
      "npm ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefer-offline",
    ].join(" "),
  ];
  break;

    case "pnpm":
      command = [
        "corepack",
        "pnpm",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
      ];
      break;

    case "yarn":
      command = [
        "corepack",
        "yarn",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
      ];
      break;
  }

  
   


  const uid =
  typeof process.getuid === "function"
    ? process.getuid()
    : 1000;

const gid =
  typeof process.getgid === "function"
    ? process.getgid()
    : 1000;

  


  const result =
  await runDockerSandboxCommand({

mounts:
  packageManager === "npm"
    ? [
        {
          source: npmCachePath,
          target: "/deployguard-cache/npm",
        },
      ]
    : [],

    repositoryPath,
    command,

    network: "bridge",

    user: `${uid}:${gid}`,

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
      cpus: 1,
      timeoutMs:
        10 * 60 * 1000,
    },
  });

  const combinedOutput =
  `${result.stdout}\n${result.stderr}`;

const networkFailure =
  /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network aborted|network connectivity/i.test(
    combinedOutput
  );

  return {
    status: result.status,
    packageManager,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs:
      result.durationMs,
      

    // summary:
    //   result.status === "passed"
    //     ? `Sandbox workspace prepared successfully using ${packageManager}.`
    //     : `Sandbox workspace preparation failed using ${packageManager}.`,

    summary:
  result.status === "passed"
    ? `Sandbox workspace prepared successfully using ${packageManager}.`
    : networkFailure
      ? `Sandbox workspace preparation could not complete because of a package registry or network error.`
      : `Sandbox workspace preparation failed using ${packageManager}.`,
  };

  
}