import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  join,
} from "node:path";

import {
  runSandboxBuildAgent,
} from "../sandbox-build-agent";

let repositoryPath: string | undefined;

afterEach(() => {
  if (repositoryPath) {
    rmSync(
      repositoryPath,
      {
        recursive: true,
        force: true,
      }
    );

    repositoryPath = undefined;
  }
});

describe(
  "runSandboxBuildAgent environment preconditions",
  () => {
    it(
      "blocks before sandbox execution when a required build environment variable is unavailable",
      async () => {
        const fixtureRoot =
          join(
            process.cwd(),
            ".deployguard",
            "test-fixtures"
          );

        mkdirSync(
          fixtureRoot,
          {
            recursive: true,
          }
        );

        repositoryPath =
          mkdtempSync(
            join(
              fixtureRoot,
              "build-gate-"
            )
          );

        /*
         * A lockfile is required so the build agent gets
         * past package-manager detection and reaches the
         * environment precondition gate.
         */
        writeFileSync(
          join(
            repositoryPath,
            "package.json"
          ),
          JSON.stringify(
            {
              name: "build-gate-test",
              version: "1.0.0",
              scripts: {
                build:
                  "node build.js",
              },
            },
            null,
            2
          )
        );

        writeFileSync(
          join(
            repositoryPath,
            "package-lock.json"
          ),
          JSON.stringify(
            {
              name: "build-gate-test",
              version: "1.0.0",
              lockfileVersion: 3,
              requires: true,
              packages: {
                "": {
                  name: "build-gate-test",
                  version: "1.0.0",
                },
              },
            },
            null,
            2
          )
        );

        /*
         * If sandbox execution occurs, this command would
         * fail deliberately.
         *
         * The expected blocked result proves DeployGuard
         * returned before attempting the build.
         */
        writeFileSync(
          join(
            repositoryPath,
            "build.js"
          ),
          `
throw new Error(
  "BUILD COMMAND MUST NOT EXECUTE"
);
`
        );

        const result =
          await runSandboxBuildAgent(
            repositoryPath,
            [
              {
                variable:
                  "BUILD_SECRET",
                required: true,
                available: false,
              },
            ]
          );

        expect(result.status).toBe(
          "blocked"
        );

        expect(result.command).toBe(
          "npm run build"
        );

        expect(result.exitCode).toBeUndefined();

        expect(result.summary).toContain(
          "BUILD_SECRET"
        );

        expect(result.evidence).toEqual([
          {
            kind: "diagnostic",
            message:
              "BUILD_SECRET is required during the build phase, " +
              "but no explicit repository environment value was supplied.",
          },
        ]);

        expect(result.stdout).toBeUndefined();
        expect(result.stderr).toBeUndefined();

        /*
         * Policy metadata should replace the generic
         * fallback diagnostic with the evidence-derived
         * provisioning explanation.
         */
        const policyAwareResult =
          await runSandboxBuildAgent(
            repositoryPath,
            [
              {
                variable:
                  "BUILD_SECRET",
                required: true,
                available: false,
                provisioningAction:
                  "require_explicit_value",
                provisioningReason:
                  "BUILD_SECRET is required during build and classified as sensitive. " +
                  "An explicit repository-scoped value is required.",
              },
            ]
          );

        expect(
          policyAwareResult.status
        ).toBe("blocked");

        expect(
          policyAwareResult.evidence
        ).toEqual([
          {
            kind: "diagnostic",
            message:
              "BUILD_SECRET is required during build and classified as sensitive. " +
              "An explicit repository-scoped value is required.",
          },
        ]);
      }
    );
    it(
      "allows an explicitly supplied repository environment value to reach build execution",
      async () => {
        const fixtureRoot =
          join(
            process.cwd(),
            ".deployguard",
            "test-fixtures"
          );

        mkdirSync(
          fixtureRoot,
          {
            recursive: true,
          }
        );

        repositoryPath =
          mkdtempSync(
            join(
              fixtureRoot,
              "build-env-"
            )
          );

        writeFileSync(
          join(
            repositoryPath,
            "package.json"
          ),
          JSON.stringify(
            {
              name: "build-env-test",
              version: "1.0.0",
              scripts: {
                build:
                  "node build.js",
              },
            },
            null,
            2
          )
        );

        writeFileSync(
          join(
            repositoryPath,
            "package-lock.json"
          ),
          JSON.stringify(
            {
              name: "build-env-test",
              version: "1.0.0",
              lockfileVersion: 3,
              requires: true,
              packages: {
                "": {
                  name: "build-env-test",
                  version: "1.0.0",
                },
              },
            },
            null,
            2
          )
        );

        writeFileSync(
          join(
            repositoryPath,
            "build.js"
          ),
          `
if (
  process.env.BUILD_SECRET !==
  "repository-scoped-secret"
) {
  throw new Error(
    "Expected repository-scoped build environment value."
  );
}

console.log(
  "Repository-scoped environment value received."
);
`
        );

        const result =
          await runSandboxBuildAgent(
            repositoryPath,
            [
              {
                variable:
                  "BUILD_SECRET",
                required: true,
                available: true,
                value:
                  "repository-scoped-secret",
                provisioningAction:
                  "require_explicit_value",
                provisioningReason:
                  "Explicit repository-scoped value supplied.",
              },
            ]
          );

        expect(result.status).toBe(
          "passed"
        );

        expect(result.stdout).toContain(
          "Repository-scoped environment value received."
        );
      }
    );

  }
);
