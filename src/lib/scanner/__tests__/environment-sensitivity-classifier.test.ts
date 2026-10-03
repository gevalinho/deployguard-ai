import {
  describe,
  expect,
  it,
} from "vitest";

import {
  classifyEnvironmentSensitivity,
} from "../environment-sensitivity-classifier";

import type {
  RepositoryFact,
} from "@/lib/evidence/types";

function environmentFact(
  variable: string
): RepositoryFact {
  return {
    key: "environmentVariable",
    value: variable,
    confidence: 0.9,
    evidence: [
      {
        source: "file",
        path: "src/example.ts",
        description:
          `${variable} is referenced by repository source.`,
      },
    ],
  };
}

function classify(
  variable: string
) {
  return classifyEnvironmentSensitivity(
    [
      environmentFact(
        variable
      ),
    ]
  )[0];
}

describe(
  "classifyEnvironmentSensitivity",
  () => {
    it(
      "classifies explicitly public variables",
      () => {
        const result =
          classify(
            "NEXT_PUBLIC_API_URL"
          );

        expect(
          result.sensitivity
        ).toBe("public");

        expect(
          result.confidence
        ).toBe(0.9);
      }
    );

    it(
      "classifies obvious secret variables",
      () => {
        const variables = [
          "DEPLOYGUARD_SESSION_SECRET",
          "GITHUB_APP_CLIENT_SECRET",
          "NEBIUS_API_KEY",
          "AUTH_TOKEN",
          "DATABASE_URL",
          "ADMIN_PASSWORD",
        ];

        for (
          const variable of variables
        ) {
          expect(
            classify(variable)
              .sensitivity
          ).toBe("secret");
        }
      }
    );

    it(
      "classifies ordinary environment values as configuration",
      () => {
        const result =
          classify(
            "NODE_ENV"
          );

        expect(
          result.sensitivity
        ).toBe(
          "configuration"
        );

        expect(
          result.confidence
        ).toBe(0.6);
      }
    );

    it(
      "preserves uncertainty for contradictory public secret naming",
      () => {
        const result =
          classify(
            "NEXT_PUBLIC_API_SECRET"
          );

        expect(
          result.sensitivity
        ).toBe("unknown");

        expect(
          result.confidence
        ).toBe(0.5);
      }
    );

    it(
      "ignores unrelated repository facts",
      () => {
        const facts: RepositoryFact[] = [
          {
            key: "framework",
            value: "Next.js",
            confidence: 0.9,
            evidence: [],
          },
        ];

        expect(
          classifyEnvironmentSensitivity(
            facts
          )
        ).toEqual([]);
      }
    );
  }
);
