import type {
  CheckCategory,
  CheckResult,
} from "@/lib/checks/types";

const CATEGORY_WEIGHTS: Record<CheckCategory, number> = {
  build: 30,
  types: 15,
  lint: 10,
  test: 20,
  security: 10,
  database: 5,
  deployment: 5,
  environment: 5,
};

export interface ReadinessScore {
  score: number;
  coverage: number;

  earnedWeight: number;
  evaluatedWeight: number;
  applicableWeight: number;
  totalWeight: number;

  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  totalChecks: number;

  readinessGaps: CheckCategory[];
  unevaluatedCategories: CheckCategory[];
  notApplicableCategories: CheckCategory[];
}

export function calculateReadinessScore(
  checks: CheckResult[]
): ReadinessScore {
  const categories = Object.keys(
    CATEGORY_WEIGHTS
  ) as CheckCategory[];

  const totalWeight = Object.values(
    CATEGORY_WEIGHTS
  ).reduce((total, weight) => total + weight, 0);

  let applicableWeight = totalWeight;
  let evaluatedWeight = 0;
  let earnedWeight = 0;

  const readinessGaps: CheckCategory[] = [];
  const unevaluatedCategories: CheckCategory[] = [];
  const notApplicableCategories: CheckCategory[] = [];

  for (const category of categories) {
    const categoryChecks = checks.filter(
      (check) => check.category === category
    );

    if (categoryChecks.length === 0) {
      unevaluatedCategories.push(category);
      continue;
    }

    const weight = CATEGORY_WEIGHTS[category];

    const allNotApplicable = categoryChecks.every(
      (check) =>
        check.status === "skipped" &&
        check.skipReason === "not_applicable"
    );

    if (allNotApplicable) {
      applicableWeight -= weight;
      notApplicableCategories.push(category);
      continue;
    }

    const hasNotConfigured = categoryChecks.some(
      (check) =>
        check.status === "skipped" &&
        check.skipReason === "not_configured"
    );

    if (hasNotConfigured) {
      evaluatedWeight += weight;
      readinessGaps.push(category);
      continue;
    }

    const passedChecks = categoryChecks.filter(
      (check) => check.status === "passed"
    ).length;

    const failedChecks = categoryChecks.filter(
      (check) => check.status === "failed"
    ).length;

    const executableChecks = passedChecks + failedChecks;

    if (executableChecks === 0) {
      unevaluatedCategories.push(category);
      continue;
    }

    evaluatedWeight += weight;

    earnedWeight +=
      weight * (passedChecks / executableChecks);

    if (failedChecks > 0) {
      readinessGaps.push(category);
    }
  }

  const score =
    evaluatedWeight === 0
      ? 0
      : Math.round(
          (earnedWeight / evaluatedWeight) * 100
        );

  const coverage =
    applicableWeight === 0
      ? 100
      : Math.round(
          (evaluatedWeight / applicableWeight) * 100
        );

  const passed = checks.filter(
    (check) => check.status === "passed"
  ).length;

  const failed = checks.filter(
    (check) => check.status === "failed"
  ).length;

  const skipped = checks.filter(
    (check) => check.status === "skipped"
  ).length;

  const errors = checks.filter(
    (check) => check.status === "error"
  ).length;

  return {
    score,
    coverage,
    earnedWeight,
    evaluatedWeight,
    applicableWeight,
    totalWeight,

    passed,
    failed,
    skipped,
    errors,
    totalChecks: checks.length,

    readinessGaps,
    unevaluatedCategories,
    notApplicableCategories,
  };
}