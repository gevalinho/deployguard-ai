import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createBuildEnvironmentRequirements,
} from "../build-environment-requirements";

import type {
  PreparationRequirement,
} from "../preparation-planner";

function requirement(
  technology: string,
  phase:
    | "build"
    | "runtime"
    | "test"
    | "unknown",
  sensitivity:
    | "public"
    | "secret"
    | "unknown"
): PreparationRequirement {
  return {
    kind: "environment",
    technology,
    required: phase === "build",
    phase,
    sensitivity,
    confidence:
      phase === "unknown"
        ? 0.5
        : 0.9,
    reason:
      `${technology} test requirement.`,
    evidence: [],
  };
}

describe(
  "createBuildEnvironmentRequirements",
  () => {
    it(
      "converts a required build secret into an unavailable build precondition",
      () => {
        const result =
          createBuildEnvironmentRequirements([
            requirement(
              "BUILD_SECRET",
              "build",
              "secret"
            ),
          ]);

        expect(result).toEqual([
          {
            variable: "BUILD_SECRET",
            required: true,
            available: false,
            provisioningAction:
              "require_explicit_value",
            provisioningReason:
              "BUILD_SECRET is required during build and classified as sensitive. " +
              "An explicit repository-scoped value is required.",
          },
        ]);
      }
    );

    it(
      "does not invent values for public build configuration",
      () => {
        const result =
          createBuildEnvironmentRequirements([
            requirement(
              "NEXT_PUBLIC_API_URL",
              "build",
              "public"
            ),
          ]);

        expect(result).toEqual([
          {
            variable:
              "NEXT_PUBLIC_API_URL",
            required: true,
            available: false,
            provisioningAction:
              "require_explicit_value",
            provisioningReason:
              "NEXT_PUBLIC_API_URL is required during build. " +
              "Its value must be supplied explicitly because DeployGuard " +
              "cannot infer repository configuration safely.",
          },
        ]);
      }
    );

    it(
      "excludes runtime and test configuration from build preconditions",
      () => {
        const result =
          createBuildEnvironmentRequirements([
            requirement(
              "RUNTIME_SECRET",
              "runtime",
              "secret"
            ),
            requirement(
              "TEST_SECRET",
              "test",
              "secret"
            ),
            requirement(
              "BUILD_SECRET",
              "build",
              "secret"
            ),
          ]);

        expect(result).toEqual([
          {
            variable: "BUILD_SECRET",
            required: true,
            available: false,
            provisioningAction:
              "require_explicit_value",
            provisioningReason:
              "BUILD_SECRET is required during build and classified as sensitive. " +
              "An explicit repository-scoped value is required.",
          },
        ]);
      }
    );

    it(
      "excludes unresolved environment requirements from build preconditions",
      () => {
        const result =
          createBuildEnvironmentRequirements([
            requirement(
              "UNKNOWN_SECRET",
              "unknown",
              "unknown"
            ),
          ]);

        expect(result).toEqual([]);
      }
    );
  }
);
