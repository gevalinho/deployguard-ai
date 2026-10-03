import {
  existsSync,
  readFileSync,
} from "node:fs";

import {
  join,
} from "node:path";

import {
  detectPackageManager,
} from "@/lib/sandbox/package-manager";

import {
  createExecCommand,
  createRunScriptCommand,
  type PackageManagerCommand,
} from "@/lib/sandbox/package-manager-command";

import {
  getCorepackSandboxConfig,
} from "@/lib/sandbox/corepack-cache";

import {
  runDockerSandboxCommand,
} from "@/lib/sandbox/docker-sandbox";

interface PackageJson {
  scripts?: Record<string, string>;
}

export interface ProjectPreparationResult {
  status:
    | "passed"
    | "failed"
    | "timed_out";

  required: boolean;

  strategy:
    | "none"
    | "package_prepare"
    | "prisma_generate";

  command?: string;
  exitCode?: number | null;

  stdout: string;
  stderr: string;
  durationMs: number;

  summary: string;
}

export async function prepareSandboxProject(
  repositoryPath: string
): Promise<ProjectPreparationResult> {
  const startedAt = Date.now();

  const packageJsonPath =
    join(
      repositoryPath,
      "package.json"
    );

  const prismaSchemaPath =
    join(
      repositoryPath,
      "prisma",
      "schema.prisma"
    );

  let packageJson: PackageJson = {};

  if (existsSync(packageJsonPath)) {
    try {
      packageJson = JSON.parse(
        readFileSync(
          packageJsonPath,
          "utf8"
        )
      ) as PackageJson;
    } catch {
      return {
        status: "failed",
        required: true,
        strategy: "package_prepare",
        stdout: "",
        stderr: "",
        durationMs:
          Date.now() - startedAt,
        summary:
          "package.json could not be parsed during project preparation.",
      };
    }
  }

  const hasPrepareScript =
    typeof packageJson.scripts?.prepare ===
      "string" &&
    packageJson.scripts.prepare.trim().length > 0;

  const hasPrismaSchema =
    existsSync(prismaSchemaPath);

  if (
    !hasPrepareScript &&
    !hasPrismaSchema
  ) {
    return {
      status: "passed",
      required: false,
      strategy: "none",
      stdout: "",
      stderr: "",
      durationMs:
        Date.now() - startedAt,
      summary:
        "No recognized project preparation step was required.",
    };
  }

  const packageManager =
    detectPackageManager(
      repositoryPath
    );

  if (!packageManager) {
    return {
      status: "failed",
      required: true,
      strategy:
        hasPrepareScript
          ? "package_prepare"
          : "prisma_generate",
      stdout: "",
      stderr: "",
      durationMs:
        Date.now() - startedAt,
      summary:
        "Project preparation is required, but no supported package manager was detected.",
    };
  }

  const corepackConfig =
    getCorepackSandboxConfig(
      packageManager,
      true
    );

  let strategy:
    | "package_prepare"
    | "prisma_generate";

  let command:
    PackageManagerCommand;

  if (hasPrepareScript) {
    strategy =
      "package_prepare";

    command =
      createRunScriptCommand(
        packageManager,
        "prepare"
      );
  } else {
    strategy =
      "prisma_generate";

    command =
      createExecCommand(
        packageManager,
        "prisma",
        [
          "generate",
        ]
      );
  }

  const result =
    await runDockerSandboxCommand({
      repositoryPath,

      command:
        command.command,

      /*
       * Preparation executes only against already
       * installed dependencies. Network access is
       * intentionally disabled.
       */
      network:
        "none",

      environment: {
        ...corepackConfig.environment,

        CI: "true",

        HOME:
          "/tmp/deployguard-home",

        /*
         * Prisma configuration may require DATABASE_URL
         * while loading prisma.config.ts even though
         * `prisma generate` does not need a live database.
         *
         * Never expose the assessed repository's real
         * database credentials to the sandbox.
         */
        DATABASE_URL:
          "postgresql://deployguard:deployguard@localhost:5432/deployguard",
      },

      mounts: [
        ...corepackConfig.mounts,
      ],

      user:
        typeof process.getuid ===
          "function" &&
        typeof process.getgid ===
          "function"
          ? `${process.getuid()}:${process.getgid()}`
          : "1000:1000",

      limits: {
        memoryMb: 2048,
        cpus: 1,
        timeoutMs:
          2 * 60 * 1000,
      },
    });

  const preparationName =
    strategy === "package_prepare"
      ? "Repository prepare script"
      : "Prisma client generation";

  if (result.status === "timed_out") {
    return {
      status: "timed_out",
      required: true,
      strategy,
      command:
        command.display,
      exitCode:
        result.exitCode,
      stdout:
        result.stdout,
      stderr:
        result.stderr,
      durationMs:
        result.durationMs,
      summary:
        `${preparationName} exceeded the sandbox timeout.`,
    };
  }

  if (result.status === "failed") {
    return {
      status: "failed",
      required: true,
      strategy,
      command:
        command.display,
      exitCode:
        result.exitCode,
      stdout:
        result.stdout,
      stderr:
        result.stderr,
      durationMs:
        result.durationMs,
      summary:
        `${preparationName} failed during deterministic project preparation.`,
    };
  }

  return {
    status: "passed",
    required: true,
    strategy,
    command:
      command.display,
    exitCode:
      result.exitCode,
    stdout:
      result.stdout,
    stderr:
      result.stderr,
    durationMs:
      result.durationMs,
    summary:
      `${preparationName} completed successfully.`,
  };
}
