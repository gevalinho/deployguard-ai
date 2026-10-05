import type {
  ReadinessCategoryBreakdown,
  ReadinessCategoryStatus,
} from "@/lib/scoring/readiness-score";

type ReadinessBreakdownProps = {
  breakdown: ReadinessCategoryBreakdown[];
};

const CATEGORY_LABELS: Record<
  ReadinessCategoryBreakdown["category"],
  string
> = {
  build: "Production Build",
  types: "TypeScript",
  lint: "Lint",
  test: "Tests",
  security: "Security",
  database: "Database",
  deployment: "Deployment",
  environment: "Environment",
};

function formatStatus(status: ReadinessCategoryStatus) {
  switch (status) {
    case "passed":
      return "Passed";
    case "partial":
      return "Partial";
    case "failed":
      return "Failed";
    case "blocked":
      return "Blocked";
    case "not_configured":
      return "Not configured";
    case "not_applicable":
      return "Not applicable";
    case "unevaluated":
      return "Unevaluated";
  }
}

function describeStatus(status: ReadinessCategoryStatus) {
  switch (status) {
    case "failed":
      return "Verified check failed.";
    case "blocked":
      return "Verification could not complete because the DeployGuard sandbox or an external dependency blocked execution.";
    case "not_configured":
      return "No recognized configuration was detected for this capability.";
    case "unevaluated":
      return "This category was not evaluated in this assessment.";
    case "not_applicable":
      return "This category is outside the applicable assessment scope.";
    case "partial":
      return "Some verified checks passed and others failed.";
    case "passed":
      return "Verified checks passed.";
  }
}

function getStatusClass(status: ReadinessCategoryStatus) {
  switch (status) {
    case "passed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";

    case "partial":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";

    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-300";

    case "blocked":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";

    case "not_configured":
      return "border-sky-500/30 bg-sky-500/10 text-sky-300";

    case "not_applicable":
    case "unevaluated":
      return "border-zinc-700 bg-zinc-800/60 text-zinc-400";
  }
}

function getBarClass(status: ReadinessCategoryStatus) {
  switch (status) {
    case "passed":
      return "bg-emerald-400";

    case "partial":
      return "bg-amber-400";

    case "failed":
      return "bg-red-400";

    case "blocked":
      return "bg-amber-400";

    case "not_configured":
      return "bg-sky-400";

    case "not_applicable":
    case "unevaluated":
      return "bg-zinc-600";
  }
}

function formatWeight(value: number) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(1);
}

export function ReadinessBreakdown({
  breakdown,
}: ReadinessBreakdownProps) {
  if (breakdown.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="readiness-breakdown-title"
      className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">
            Deterministic scoring
          </p>

          <h2
            id="readiness-breakdown-title"
            className="mt-1 text-xl font-semibold text-zinc-100"
          >
            Readiness Breakdown
          </h2>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            See exactly how verified repository evidence contributes
            to the production-readiness score.
          </p>
        </div>

        <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
          Weighted categories
        </span>
      </div>

      <div className="mt-6 space-y-5">
        {breakdown.map((item) => {
          const percentage =
            item.weight > 0
              ? Math.max(
                  0,
                  Math.min(
                    100,
                    (item.earnedWeight / item.weight) * 100
                  )
                )
              : 0;

          return (
            <div key={item.category}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <p className="font-medium text-zinc-200">
                    {CATEGORY_LABELS[item.category]}
                  </p>

                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${getStatusClass(
                      item.status
                    )}`}
                  >
                    {formatStatus(item.status)}
                  </span>
                </div>

                <div className="shrink-0 text-right">
                  <span className="font-mono text-sm font-medium text-zinc-200">
                    {formatWeight(item.earnedWeight)}
                  </span>

                  <span className="font-mono text-sm text-zinc-600">
                    {" "}
                    / {formatWeight(item.weight)}
                  </span>
                </div>
              </div>

              <div
                className="h-2 overflow-hidden rounded-full bg-zinc-800"
                aria-label={`${CATEGORY_LABELS[item.category]} ${formatWeight(
                  item.earnedWeight
                )} of ${formatWeight(item.weight)} readiness points`}
              >
                <div
                  className={`h-full rounded-full transition-all duration-500 ${getBarClass(
                    item.status
                  )}`}
                  style={{
                    width: `${percentage}%`,
                  }}
                />
              </div>

              <p className="mt-1.5 text-xs text-zinc-400">
                {describeStatus(item.status)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
