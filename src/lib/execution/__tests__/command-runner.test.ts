import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  runCommand,
} from "@/lib/execution/command-runner";
import { createAssessmentExecutionContext, runAssessmentStage } from
  "@/lib/orchestration/assessment-execution";

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
    it("caps output from a noisy child process", async () => {
      const result = await runCommand(process.execPath,
        ["-e", "process.stdout.write('x'.repeat(4 * 1024 * 1024))"], process.cwd(),
        { timeoutMs: 5_000 });
      expect(result.status).toBe("passed");
      expect(result.stdout.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    });

    it("terminates a child that exceeds its command deadline", async () => {
      const result = await runCommand(process.execPath,
        ["-e", "setInterval(() => {}, 1000)"], process.cwd(), { timeoutMs: 50 });
      expect(result.timedOut).toBe(true);
      expect(result.status).toBe("failed");
    });

    it("terminates a running command when its assessment is cancelled", async () => {
      const context = createAssessmentExecutionContext();
      const pending = context.run(() => runAssessmentStage("preparation", () =>
        runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], process.cwd())));
      const assertion = expect(pending).rejects.toMatchObject({ name: "AssessmentCancelledError" });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(context.cancel("user_requested")).toBe(true);
      await assertion;
      context.dispose();
    });

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
