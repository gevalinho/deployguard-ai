import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  runCommand,
} from "@/lib/execution/command-runner";

const inheritedSecretName =
  "DEPLOYGUARD_TEST_SERVER_SECRET";

const explicitVariableName =
  "DEPLOYGUARD_TEST_EXPLICIT_VALUE";

afterEach(() => {
  delete process.env[
    inheritedSecretName
  ];

  delete process.env[
    explicitVariableName
  ];
});

describe(
  "runCommand environment isolation",
  () => {
    it(
      "does not expose the parent process environment when inheritance is disabled",
      async () => {
        const parentSecret =
          "must-not-reach-child";

        const explicitValue =
          "explicit-child-value";

        process.env[
          inheritedSecretName
        ] = parentSecret;

        const script = [
          `const inherited = process.env.${inheritedSecretName} ?? "missing";`,
          `const explicit = process.env.${explicitVariableName} ?? "missing";`,
          "process.stdout.write(JSON.stringify({ inherited, explicit }));",
        ].join("");

        const result =
          await runCommand(
            process.execPath,
            [
              "-e",
              script,
            ],
            process.cwd(),
            {
              inheritProcessEnv: false,

              env: {
                [explicitVariableName]:
                  explicitValue,
              },
            }
          );

        expect(
          result.status
        ).toBe("passed");

        const childEnvironment =
          JSON.parse(
            result.stdout
          ) as {
            inherited: string;
            explicit: string;
          };

        expect(
          childEnvironment.inherited
        ).toBe("missing");

        expect(
          childEnvironment.explicit
        ).toBe(explicitValue);

        expect(
          result.stdout
        ).not.toContain(
          parentSecret
        );
      }
    );

    it(
      "continues inheriting the parent environment by default",
      async () => {
        const parentValue =
          "default-inheritance-value";

        process.env[
          inheritedSecretName
        ] = parentValue;

        const script =
          `process.stdout.write(process.env.${inheritedSecretName} ?? "missing");`;

        const result =
          await runCommand(
            process.execPath,
            [
              "-e",
              script,
            ],
            process.cwd()
          );

        expect(
          result.status
        ).toBe("passed");

        expect(
          result.stdout
        ).toBe(parentValue);
      }
    );
  }
);
