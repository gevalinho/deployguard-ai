import {
  mkdtempSync,
  readFileSync,
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

const fixtures: Fixture[] = [
  {
    name:
      "npm",
    manager:
      "npm",
  },

  {
    name:
      "pnpm",
    manager:
      "pnpm",
    packageManager:
      "pnpm@10.19.0",
  },

  {
    name:
      "yarn-classic",
    manager:
      "yarn",
    packageManager:
      "yarn@1.22.22",
  },

  {
    name:
      "yarn-modern",
    manager:
      "yarn",
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
          `deployguard-${fixture.name}-fixture`,

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

        scripts: {
          build:
            "node -e \"console.log('build passed')\"",

          lint:
            "node -e \"console.log('lint passed')\"",

          test:
            "node -e \"console.log('tests passed')\"",
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
  switch (fixture.manager) {
    case "npm":
      run(
        "docker",
        [
          "run",
          "--rm",

          "--user",
          dockerUser,

          "-e",
          "HOME=/tmp/deployguard-home",

          "-v",
          `${repositoryPath}:/workspace`,

          "-w",
          "/workspace",

          "node:22-bookworm-slim",

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
          "run",
          "--rm",

          "--user",
          dockerUser,

          "-e",
          "HOME=/tmp/deployguard-home",

          "-v",
          `${repositoryPath}:/workspace`,

          "-w",
          "/workspace",

          "node:22-bookworm-slim",

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
          "run",
          "--rm",

          "--user",
          dockerUser,

          "-e",
          "HOME=/tmp/deployguard-home",

          "-v",
          `${repositoryPath}:/workspace`,

          "-w",
          "/workspace",

          "node:22-bookworm-slim",

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
  let passed =
    0;

  for (
    const fixture
    of fixtures
  ) {
    const repositoryPath =
      mkdtempSync(
        join(
          tmpdir(),
          `deployguard-${fixture.name}-`
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

      console.log(
        "Generated files:"
      );

      console.log(
        readFileSync(
          join(
            repositoryPath,
            "package.json"
          ),
          "utf8"
        )
      );

      const result =
        await prepareSandboxWorkspace(
          repositoryPath
        );

      console.log(
        result
      );

      if (
        result.status !==
        "passed"
      ) {
        throw new Error(
          `${fixture.name} preparation failed: ${result.summary}`
        );
      }

      console.log(
        `✓ ${fixture.name} sandbox preparation passed`
      );

      passed += 1;
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
    `\n${passed}/${fixtures.length} sandbox package-manager fixtures passed.`
  );
}

void main();