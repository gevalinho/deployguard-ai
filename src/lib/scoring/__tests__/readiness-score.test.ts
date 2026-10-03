import {
  describe,
  expect,
  it,
} from "vitest";

import {
  calculateReadinessScore,
} from "../readiness-score";

import type {
  CheckResult,
} from "@/lib/checks/types";

function check(
  id: string,
  category: CheckResult["category"],
  status: CheckResult["status"],
  skipReason?: CheckResult["skipReason"]
): CheckResult {
  return {
    id,
    category,
    name: id,
    status,
    skipReason,
    summary: `${id}: ${status}`,
  };
}

describe(
  "calculateReadinessScore",
  () => {
    it(
      "scores verified passing checks using evaluated weight",
      () => {
        const checks: CheckResult[] = [
          check(
            "build",
            "build",
            "passed"
          ),
          check(
            "types",
            "types",
            "passed"
          ),
        ];

        const result =
          calculateReadinessScore(
            checks
          );

        expect(result.score).toBe(100);
        expect(result.coverage).toBe(45);
        expect(result.earnedWeight).toBe(45);
        expect(result.evaluatedWeight).toBe(45);
        expect(result.blocked).toBe(0);
        expect(result.readinessGaps).toEqual([]);
      }
    );

    it(
      "does not treat a blocked build as a failed build",
      () => {
        const checks: CheckResult[] = [
          check(
            "build",
            "build",
            "blocked"
          ),
          check(
            "types",
            "types",
            "passed"
          ),
        ];

        const result =
          calculateReadinessScore(
            checks
          );

        expect(result.score).toBe(100);
        expect(result.coverage).toBe(15);

        expect(
          result.evaluatedWeight
        ).toBe(15);

        expect(result.blocked).toBe(1);
        expect(result.failed).toBe(0);

        expect(
          result.readinessGaps
        ).not.toContain("build");

        expect(
          result.unevaluatedCategories
        ).toContain("build");
      }
    );

    it(
      "penalizes a build that actually executes and fails",
      () => {
        const checks: CheckResult[] = [
          check(
            "build",
            "build",
            "failed"
          ),
          check(
            "types",
            "types",
            "passed"
          ),
        ];

        const result =
          calculateReadinessScore(
            checks
          );

        expect(result.score).toBe(33);
        expect(result.coverage).toBe(45);
        expect(result.earnedWeight).toBe(15);
        expect(result.evaluatedWeight).toBe(45);
        expect(result.failed).toBe(1);
        expect(result.blocked).toBe(0);

        expect(
          result.readinessGaps
        ).toContain("build");
      }
    );
  }
);
