import {
  describe,
  expect,
  it,
} from "vitest";

import {
  decideEnvironmentProvisioning,
} from "../environment-provisioning-policy";

import type {
  PreparationRequirement,
} from "../preparation-planner";

function environmentRequirement(
  variable: string,
  phase:
    | "build"
    | "runtime"
    | "test"
    | "unknown",
  sensitivity:
    | "public"
    | "secret"
    | "configuration"
    | "unknown"
): PreparationRequirement {
  return {
    kind: "environment",
    technology: variable,
    required: phase === "build",
    phase,
    sensitivity,
    confidence: 0.9,
    reason: "Test requirement.",
    evidence: [],
  };
}

describe(
  "decideEnvironmentProvisioning",
  () => {
    it(
      "requires an explicit value for build secrets",
      () => {
        const decision =
          decideEnvironmentProvisioning(
            environmentRequirement(
              "DATABASE_URL",
              "build",
              "secret"
            )
          );

        expect(decision.action).toBe(
          "require_explicit_value"
        );

        expect(
          decision.canAutoProvision
        ).toBe(false);
      }
    );

    it(
      "does not invent public build configuration",
      () => {
        const decision =
          decideEnvironmentProvisioning(
            environmentRequirement(
              "NEXT_PUBLIC_API_URL",
              "build",
              "public"
            )
          );

        expect(decision.action).toBe(
          "require_explicit_value"
        );

        expect(
          decision.canAutoProvision
        ).toBe(false);
      }
    );

    it(
      "requires explicit ordinary build configuration",
      () => {
        const decision =
          decideEnvironmentProvisioning(
            environmentRequirement(
              "APP_ORIGIN",
              "build",
              "configuration"
            )
          );

        expect(decision.action).toBe(
          "require_explicit_value"
        );
      }
    );

    it(
      "defers runtime configuration",
      () => {
        const decision =
          decideEnvironmentProvisioning(
            environmentRequirement(
              "RUNTIME_SECRET",
              "runtime",
              "secret"
            )
          );

        expect(decision.action).toBe(
          "defer_to_runtime"
        );
      }
    );

    it(
      "defers test configuration",
      () => {
        const decision =
          decideEnvironmentProvisioning(
            environmentRequirement(
              "TEST_DATABASE_URL",
              "test",
              "secret"
            )
          );

        expect(decision.action).toBe(
          "defer_to_test"
        );
      }
    );

    it(
      "preserves uncertainty for unknown execution phase",
      () => {
        const decision =
          decideEnvironmentProvisioning(
            environmentRequirement(
              "UNKNOWN_VALUE",
              "unknown",
              "unknown"
            )
          );

        expect(decision.action).toBe(
          "unresolved"
        );

        expect(
          decision.canAutoProvision
        ).toBe(false);
      }
    );

    it(
      "rejects non-environment requirements",
      () => {
        const requirement:
          PreparationRequirement = {
            kind: "dependency_install",
            technology: "Node.js",
            required: true,
            reason: "Test requirement.",
            evidence: [],
          };

        expect(() =>
          decideEnvironmentProvisioning(
            requirement
          )
        ).toThrow(
          "Environment provisioning policy requires an environment preparation requirement."
        );
      }
    );
  }
);
