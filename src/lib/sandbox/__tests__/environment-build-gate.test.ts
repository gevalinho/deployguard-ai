import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createPreparationPlan,
} from "../preparation-planner";

import type {
  RepositoryFact,
} from "@/lib/evidence/types";

function environmentFact(
  variable: string,
  evidencePath: string
): RepositoryFact {
  return {
    key: "environmentVariable",
    value: variable,
    confidence: 0.9,
    evidence: [
      {
        source: "file",
        path: evidencePath,
        description:
          `Environment variable ${variable} referenced in ${evidencePath}.`,
      },
    ],
  };
}

describe(
  "environment build preparation",
  () => {
    it(
      "requires environment variables proven to be used during build",
      () => {
        const facts: RepositoryFact[] = [
          environmentFact(
            "BUILD_SECRET",
            "next.config.ts"
          ),
        ];

        const plan =
          createPreparationPlan(
            facts
          );

        const requirement =
          plan.requirements.find(
            (item) =>
              item.kind ===
                "environment" &&
              item.technology ===
                "BUILD_SECRET"
          );

        expect(requirement).toBeDefined();

        expect(
          requirement?.phase
        ).toBe("build");

        expect(
          requirement?.required
        ).toBe(true);

        expect(
          requirement?.confidence
        ).toBe(0.9);
      }
    );

    it(
      "does not make runtime environment variables build prerequisites",
      () => {
        const facts: RepositoryFact[] = [
          environmentFact(
            "RUNTIME_SECRET",
            "src/app/api/demo/route.ts"
          ),
        ];

        const plan =
          createPreparationPlan(
            facts
          );

        const requirement =
          plan.requirements.find(
            (item) =>
              item.kind ===
                "environment" &&
              item.technology ===
                "RUNTIME_SECRET"
          );

        expect(requirement).toBeDefined();

        expect(
          requirement?.phase
        ).toBe("runtime");

        expect(
          requirement?.required
        ).toBe(false);
      }
    );

    it(
      "does not make test environment variables build prerequisites",
      () => {
        const facts: RepositoryFact[] = [
          environmentFact(
            "TEST_SECRET",
            "tests/example.test.ts"
          ),
        ];

        const plan =
          createPreparationPlan(
            facts
          );

        const requirement =
          plan.requirements.find(
            (item) =>
              item.kind ===
                "environment" &&
              item.technology ===
                "TEST_SECRET"
          );

        expect(requirement).toBeDefined();

        expect(
          requirement?.phase
        ).toBe("test");

        expect(
          requirement?.required
        ).toBe(false);
      }
    );

    it(
      "preserves uncertainty when execution phase cannot be proven",
      () => {
        const facts: RepositoryFact[] = [
          environmentFact(
            "UNKNOWN_SECRET",
            "scripts/custom.ts"
          ),
        ];

        const plan =
          createPreparationPlan(
            facts
          );

        const requirement =
          plan.requirements.find(
            (item) =>
              item.kind ===
                "environment" &&
              item.technology ===
                "UNKNOWN_SECRET"
          );

        expect(requirement).toBeDefined();

        expect(
          requirement?.phase
        ).toBe("unknown");

        expect(
          requirement?.required
        ).toBe(false);

        expect(
          requirement?.confidence
        ).toBe(0.5);
      }
    );
  }
);
