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

    it(
  "exposes deterministic category breakdown",
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
      check(
        "tests",
        "test",
        "skipped",
        "not_configured"
      ),
    ];

    const result =
      calculateReadinessScore(checks);

    expect(
      result.breakdown.find(
        (item) =>
          item.category === "build"
      )
    ).toEqual({
      category: "build",
      weight: 30,
      earnedWeight: 0,
      evaluated: false,
      status: "blocked",
    });

    expect(
      result.breakdown.find(
        (item) =>
          item.category === "types"
      )
    ).toEqual({
      category: "types",
      weight: 15,
      earnedWeight: 15,
      evaluated: true,
      status: "passed",
    });

    expect(
      result.breakdown.find(
        (item) =>
          item.category === "test"
      )
    ).toEqual({
      category: "test",
      weight: 20,
      earnedWeight: 0,
      evaluated: true,
      status: "not_configured",
    });
  }
);

it(
  "reports partial category credit when checks have mixed results",
  () => {
    const checks: CheckResult[] = [
      check(
        "build-pass",
        "build",
        "passed"
      ),
      check(
        "build-fail",
        "build",
        "failed"
      ),
    ];

    const result =
      calculateReadinessScore(checks);

    const build =
      result.breakdown.find(
        (item) =>
          item.category === "build"
      );

    expect(build).toEqual({
      category: "build",
      weight: 30,
      earnedWeight: 15,
      evaluated: true,
      status: "partial",
    });

    expect(result.score).toBe(50);
    expect(result.earnedWeight).toBe(15);
    expect(result.evaluatedWeight).toBe(30);

    expect(
      result.readinessGaps
    ).toContain("build");
  }
);
  }
);
