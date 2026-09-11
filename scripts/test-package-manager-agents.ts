import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import {
  prepareSandboxWorkspace,
} from "@/lib/sandbox/workspace-preparation";

import {
  runSandboxBuildAgent,
} from "@/lib/agents/sandbox-build-agent";

import {
  runSandboxTypecheckAgent,
} from "@/lib/agents/sandbox-typecheck-agent";

import {
  runSandboxLintAgent,
} from "@/lib/agents/sandbox-lint-agent";

import {
  runSandboxTestAgent,
} from "@/lib/agents/sandbox-test-agent";

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
    name: "npm",
    manager: "npm",
  },
  {
    name: "pnpm",
    manager: "pnpm",
    packageManager: "pnpm@10.19.0",
  },
  {
    name: "yarn-classic",
    manager: "yarn",
    packageManager: "yarn@1.22.22",
  },
  {
    name: "yarn-modern",
    manager: "yarn",
    packageManager: "yarn@4.9.2",
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
        stdio: "inherit",
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

function writeFixture(
  repositoryPath: string,
  fixture: Fixture
): void {
  writeFileSync(
    join(repositoryPath, "package.json"),
    JSON.stringify(
      {
        name:
          `deployguard-${fixture.name}-agent-fixture`,

        version: "1.0.0",

        private: true,

        ...(fixture.packageManager
          ? {
              packageManager:
                fixture.packageManager,
            }
          : {}),

        dependencies: {
          lodash: "4.17.21",
        },

        devDependencies: {
          typescript: "5.9.2",
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

  writeFileSync(
    join(repositoryPath, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "CommonJS",
          strict: true,
          noEmit: true,
        },
        include: [
          "src/**/*.ts",
        ],
      },
      null,
      2
    )
  );

  writeFileSync(
    join(repositoryPath, "index.ts"),
    [
      "const message: string = 'DeployGuard';",
      "console.log(message);",
      "",
    ].join("\n")
  );

  /*
 * Keep the source under src because the
 * fixture tsconfig evaluates TypeScript files
 * inside the src directory.
 */
  run(
    "mkdir",
    [
      "-p",
      join(repositoryPath, "src"),
    ],
    repositoryPath
  );

  writeFileSync(
    join(
      repositoryPath,
      "src",
      "index.ts"
    ),
    [
      "const message: string = 'DeployGuard';",
      "console.log(message);",
      "",
    ].join("\n")
  );
}

function createLockfile(
  repositoryPath: string,
  fixture: Fixture
): void {
  const corepackCachePath =
  join(
    process.cwd(),
    ".deployguard",
    "cache",
    "corepack"
  );

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
  let passedFixtures = 0;

  for (const fixture of fixtures) {
    const repositoryPath =
      mkdtempSync(
        join(
          tmpdir(),
          `deployguard-agents-${fixture.name}-`
        )
      );

    console.log(
      `\n=== ${fixture.name} ===`
    );

    try {
      writeFixture(
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
        console.error(preparation);

        throw new Error(
          `${fixture.name}: preparation failed`
        );
      }

      const typecheck =
        await runSandboxTypecheckAgent(
          repositoryPath
        );

      const lint =
        await runSandboxLintAgent(
          repositoryPath
        );

      const test =
        await runSandboxTestAgent(
          repositoryPath
        );

      const build =
        await runSandboxBuildAgent(
          repositoryPath
        );

      const results = [
        {
          name: "TypeScript",
          result: typecheck,
        },
        {
          name: "Lint",
          result: lint,
        },
        {
          name: "Tests",
          result: test,
        },
        {
          name: "Build",
          result: build,
        },
      ];

      let fixturePassed = true;

      console.log(
        "\nAgent results:"
      );

      for (
        const {
          name,
          result,
        } of results
      ) {
        const ok =
          result.status === "passed";

        console.log(
          `${ok ? "✓" : "✗"} ${name}: ${result.status}`
        );

        if (!ok) {
          fixturePassed = false;

          console.log(
            result
          );
        }
      }

      if (!fixturePassed) {
        throw new Error(
          `${fixture.name}: one or more agents failed`
        );
      }

      passedFixtures += 1;

      console.log(
        `✓ ${fixture.name} agent compatibility passed`
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
    `\n${passedFixtures}/${fixtures.length} package-manager agent fixtures passed.`
  );

  if (
    passedFixtures !==
    fixtures.length
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