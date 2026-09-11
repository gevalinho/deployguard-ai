import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  join,
} from "node:path";

import {
  tmpdir,
} from "node:os";

import {
  spawnSync,
} from "node:child_process";

import {
  prepareSandboxWorkspace,
} from "@/lib/sandbox/workspace-preparation";

import {
  runSandboxSecurityAgent,
} from "@/lib/agents/sandbox-security-agent";

type FixtureManager =
  | "npm"
  | "pnpm"
  | "yarn";

interface Fixture {
  name: string;
  manager: FixtureManager;
  packageManager?: string;
}

const hostUid =
  typeof process.getuid === "function"
    ? process.getuid()
    : 1000;

const hostGid =
  typeof process.getgid === "function"
    ? process.getgid()
    : 1000;

const dockerUser =
  `${hostUid}:${hostGid}`;

const corepackCachePath =
  join(
    process.cwd(),
    ".deployguard",
    "cache",
    "corepack"
  );

const fixtures: Fixture[] = [
  {
    name: "npm",
    manager: "npm",
  },
  {
    name: "pnpm",
    manager: "pnpm",
    packageManager:
      "pnpm@10.19.0",
  },
  {
    name: "yarn-classic",
    manager: "yarn",
    packageManager:
      "yarn@1.22.22",
  },
  {
    name: "yarn-modern",
    manager: "yarn",
    packageManager:
      "yarn@4.9.2",
  },
];

function run(
  command: string,
  args: string[],
  cwd: string
): void {
  const result =
    spawnSync(
      command,
      args,
      {
        cwd,
        stdio:
          "inherit",
      }
    );

  if (
    result.error ||
    result.status !== 0
  ) {
    throw new Error(
      `${command} ${args.join(" ")} failed`
    );
  }
}

function writeFixturePackageJson(
  repositoryPath: string,
  fixture: Fixture
): void {
  writeFileSync(
    join(
      repositoryPath,
      "package.json"
    ),
    JSON.stringify(
      {
        name:
          `deployguard-${fixture.name}-security-fixture`,

        version:
          "1.0.0",

        private:
          true,

        ...(fixture.packageManager
          ? {
              packageManager:
                fixture.packageManager,
            }
          : {}),

        dependencies: {
          lodash:
            "4.17.21",
        },
      },
      null,
      2
    )
  );
}

function createLockfile(
  repositoryPath: string,
  fixture: Fixture
): void {
  const commonDockerArgs = [
    "run",
    "--rm",

    "--user",
    dockerUser,

    "-e",
    "HOME=/tmp/deployguard-home",

    "-e",
    "COREPACK_HOME=/deployguard-cache/corepack",

    "-v",
    `${repositoryPath}:/workspace`,

    "-v",
    `${corepackCachePath}:/deployguard-cache/corepack`,

    "-w",
    "/workspace",

    "node:22-bookworm-slim",
  ];

  switch (fixture.manager) {
    case "npm":
      run(
        "docker",
        [
          ...commonDockerArgs,

          "npm",
          "install",
          "--package-lock-only",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ],
        repositoryPath
      );

      return;

    case "pnpm":
      run(
        "docker",
        [
          ...commonDockerArgs,

          "corepack",
          "pnpm",
          "install",
          "--lockfile-only",
          "--ignore-scripts",
        ],
        repositoryPath
      );

      return;

    case "yarn":
      run(
        "docker",
        [
          ...commonDockerArgs,

          "corepack",
          "yarn",
          "install",
        ],
        repositoryPath
      );

      return;
  }
}

async function main(): Promise<void> {
  let passed = 0;

  for (const fixture of fixtures) {
    const repositoryPath =
      mkdtempSync(
        join(
          tmpdir(),
          `deployguard-security-${fixture.name}-`
        )
      );

    console.log(
      `\n=== ${fixture.name} ===`
    );

    try {
      writeFixturePackageJson(
        repositoryPath,
        fixture
      );

      createLockfile(
        repositoryPath,
        fixture
      );

      const preparation =
        await prepareSandboxWorkspace(
          repositoryPath
        );

      console.log(
        "\nPreparation:",
        preparation.status
      );

      if (
        preparation.status !== "passed"
      ) {
        console.log(
          preparation
        );

        throw new Error(
          `${fixture.name}: preparation failed`
        );
      }

      const security =
        await runSandboxSecurityAgent(
          repositoryPath
        );

      console.log(
        "\nSecurity result:"
      );

      console.log(
        security
      );

      /*
       * Both "passed" and "failed" are valid
       * compatibility outcomes here.
       *
       * passed = audit ran and found no
       * high/critical vulnerabilities.
       *
       * failed = audit ran successfully and
       * found high/critical vulnerabilities.
       *
       * error/skipped mean the audit path
       * itself was not successfully exercised.
       */
      const acceptableStatuses = [
        "passed",
        "failed",
      ];

      if (
        !acceptableStatuses.includes(
          security.status
        )
      ) {
        throw new Error(
          `${fixture.name}: security audit did not execute correctly`
        );
      }

      passed += 1;

      console.log(
        `✓ ${fixture.name} security compatibility passed (${security.status})`
      );
    } finally {
      rmSync(
        repositoryPath,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }

  console.log(
    `\n${passed}/${fixtures.length} package-manager security fixtures passed.`
  );

  if (
    passed !== fixtures.length
  ) {
    process.exitCode = 1;
  }
}

main().catch(
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);