"use client";

import {
  useMemo,
  useState,
} from "react";

type RepositoryFact = {
  key: string;
  value: string;
  confidence: number;
  evidence: {
    source: string;
    path: string;
    description: string;
  }[];
};

type RemoteScanResult = {
  repository: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
  };
  scan: {
    scannedAt: string;
    facts: RepositoryFact[];
  };
};

type CheckStatus =
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "error";

type CheckResult = {
  id: string;
  category: string;
  name: string;
  status: CheckStatus;
  skipReason?: string;
  summary: string;
};

type ReadinessReport = {
  generatedAt: string;

  architecture?: {
    summary: string;
    architectureType: string;
    recommendedChecks: string[];
  };

  checks: CheckResult[];

  readiness: {
    score: number;
    coverage: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    errors: number;
    readinessGaps: string[];
    notApplicableCategories: string[];
  };

  remediation: {
    category: string;
    priority:
      | "low"
      | "medium"
      | "high";
    title: string;
    recommendation: string;
  }[];
};

type AssessmentProgressStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "error"
  | "completed";

type AssessmentProgressEvent = {
  stage: string;
  label: string;
  status: AssessmentProgressStatus;
  message?: string;
  elapsedMs?: number;
};

type ResearchEvidenceSummary = {
  title: string;
  url: string;
  sourceType: string;
  authority:
    | "primary"
    | "secondary"
    | "community";
  publisher?: string;
  publishedAt?: string;
};

type ResearchSummary = {
  queries: string[];
  evidence: ResearchEvidenceSummary[];
};

type AssessmentResult = {
  repository: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
  };
  research?: ResearchSummary;
  report: ReadinessReport;
};

const ASSESSMENT_STAGES = [
  {
    stage: "repository",
    label: "Repository",
  },
  {
    stage: "scan",
    label: "Repository Scan",
  },
  {
    stage: "research",
    label: "External Research",
  },
  {
    stage: "preparation",
    label: "Sandbox Preparation",
  },
  {
    stage: "types",
    label: "TypeScript",
  },
  {
    stage: "lint",
    label: "Lint",
  },
  {
    stage: "test",
    label: "Tests",
  },
  {
    stage: "build",
    label: "Production Build",
  },
  {
    stage: "security",
    label: "Dependency Security",
  },
  {
    stage: "architect",
    label: "Nemotron Analysis",
  },
  {
    stage: "report",
    label: "Readiness Report",
  },
] as const;

const PROCESS_STEPS = [
  {
    step: "01",
    title: "Evidence",
    description:
      "Inspect the repository and execute real checks.",
  },
  {
    step: "02",
    title: "Verification",
    description:
      "Validate build, types, tests, security and deployment.",
  },
  {
    step: "03",
    title: "AI Reasoning",
    description:
      "Nemotron reasons only over collected evidence.",
  },
  {
    step: "04",
    title: "Readiness",
    description:
      "Calculate a deterministic score and remediation plan.",
  },
] as const;

function getStatusLabel(
  check: CheckResult
) {
  if (
    check.status === "skipped" &&
    check.skipReason ===
      "not_applicable"
  ) {
    return "Not applicable";
  }

  if (
    check.status === "skipped" &&
    check.skipReason ===
      "not_configured"
  ) {
    return "Not configured";
  }

  if (
    check.status === "skipped" &&
    check.skipReason ===
      "unsupported"
  ) {
    return "Unsupported";
  }

  return check.status;
}

function getProgressSymbol(
  status: AssessmentProgressStatus
) {
  switch (status) {
    case "running":
      return "⏳";

    case "passed":
    case "completed":
      return "✓";

    case "blocked":
      return "!";

    case "skipped":
      return "○";

    case "failed":
      return "✕";

    case "error":
      return "!";

    default:
      return "·";
  }
}

function getProgressTextClass(
  status: AssessmentProgressStatus
) {
  switch (status) {
    case "passed":
    case "completed":
      return "text-emerald-400";

    case "failed":
      return "text-red-400";

    case "error":
    case "blocked":
      return "text-amber-400";

    case "running":
      return "text-blue-400";

    case "skipped":
      return "text-zinc-500";

    default:
      return "text-zinc-600";
  }
}

function getCheckStatusClass(
  check: CheckResult
) {
  if (check.status === "passed") {
    return (
      "border-emerald-500/30 " +
      "bg-emerald-500/10 " +
      "text-emerald-300"
    );
  }

  if (
    check.status === "blocked" ||
    (check.status === "skipped" &&
      check.skipReason ===
        "not_configured")
  ) {
    return (
      "border-amber-500/30 " +
      "bg-amber-500/10 " +
      "text-amber-300"
    );
  }

  if (check.status === "failed") {
    return (
      "border-red-500/30 " +
      "bg-red-500/10 " +
      "text-red-300"
    );
  }

  if (check.status === "error") {
    return (
      "border-orange-500/30 " +
      "bg-orange-500/10 " +
      "text-orange-300"
    );
  }

  return (
    "border-zinc-700 " +
    "bg-zinc-800/50 " +
    "text-zinc-400"
  );
}

function getScoreBarClass(
  score: number
) {
  if (score >= 80) {
    return "bg-emerald-400";
  }

  if (score >= 60) {
    return "bg-amber-400";
  }

  return "bg-red-400";
}

function formatElapsed(
  elapsedMs?: number
) {
  if (elapsedMs === undefined) {
    return "";
  }

  const totalSeconds =
    Math.floor(elapsedMs / 1000);

  const minutes =
    Math.floor(totalSeconds / 60);

  const seconds =
    totalSeconds % 60;

  return `${minutes}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function parseSseBlock(
  block: string
): {
  event: string;
  data: unknown;
} | null {
  const lines =
    block.split("\n");

  let event = "message";

  const dataLines: string[] = [];

  for (const line of lines) {
    if (
      line.startsWith("event:")
    ) {
      event =
        line.slice(6).trim();

      continue;
    }

    if (
      line.startsWith("data:")
    ) {
      dataLines.push(
        line.slice(5).trim()
      );
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return {
      event,
      data: JSON.parse(
        dataLines.join("\n")
      ),
    };
  } catch {
    return null;
  }
}

function StatusBadge({
  check,
}: {
  check: CheckResult;
}) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium capitalize ${getCheckStatusClass(
        check
      )}`}
    >
      {getStatusLabel(check)}
    </span>
  );
}

function ProcessOverview() {
  return (
    <div className="mt-8 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {PROCESS_STEPS.map(
        (item) => (
          <div
            key={item.step}
            className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
          >
            <p className="font-mono text-xs text-zinc-600">
              {item.step}
            </p>

            <p className="mt-2 font-medium text-zinc-200">
              {item.title}
            </p>

            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {item.description}
            </p>
          </div>
        )
      )}
    </div>
  );
}

function AssessmentPipeline({
  loading,
  progressByStage,
}: {
  loading: boolean;
  progressByStage: Map<
    string,
    AssessmentProgressEvent
  >;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">
            Live verification
          </p>

          <h2 className="mt-1 text-xl font-semibold">
            Assessment Pipeline
          </h2>
        </div>

        {loading && (
          <span className="text-sm text-zinc-500">
            Running
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        {ASSESSMENT_STAGES.map(
          ({
            stage,
            label,
          }) => {
            const progress =
              progressByStage.get(
                stage
              );

            const status =
              progress?.status ??
              "pending";

            return (
              <div
                key={stage}
                className="flex gap-4 border-b border-zinc-800 p-5 last:border-b-0"
              >
                <div
                  className={`w-6 shrink-0 text-center font-semibold ${getProgressTextClass(
                    status
                  )}`}
                >
                  {getProgressSymbol(
                    status
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium">
                      {label}
                    </p>

                    {progress?.elapsedMs !==
                      undefined && (
                      <span className="font-mono text-xs text-zinc-600">
                        {formatElapsed(
                          progress.elapsedMs
                        )}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-sm leading-6 text-zinc-500">
                    {progress?.message ??
                      (status ===
                      "pending"
                        ? "Waiting..."
                        : "")}
                  </p>
                </div>
              </div>
            );
          }
        )}
      </div>
    </section>
  );
}

function ReadinessScoreCard({
  score,
}: {
  score: number;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-zinc-400">
            Production Readiness
          </p>

          <p className="mt-2 text-5xl font-semibold">
            {score}

            <span className="text-2xl text-zinc-500">
              /100
            </span>
          </p>
        </div>

        <span className="w-fit shrink-0 whitespace-nowrap rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
          Deterministic
        </span>
      </div>

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getScoreBarClass(
            score
          )}`}
          style={{
            width: `${score}%`,
          }}
        />
      </div>

      <p className="mt-4 text-sm font-medium leading-6 text-zinc-300">
        Score reflects verified
        readiness only. Blocked and
        unconfigured areas do not
        receive readiness credit.
      </p>

      <p className="mt-2 text-sm leading-6 text-zinc-500">
        Calculated from verified
        build, type, lint, test,
        security, database,
        deployment and environment
        evidence — not from an AI
        opinion.
      </p>
    </div>
  );
}

function CoverageCard({
  coverage,
}: {
  coverage: number;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-zinc-400">
            Assessment Coverage
          </p>

          <p className="mt-2 text-5xl font-semibold">
            {coverage}

            <span className="text-2xl text-zinc-500">
              %
            </span>
          </p>
        </div>

        <span className="w-fit shrink-0 whitespace-nowrap rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
          Evidence coverage
        </span>
      </div>

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-sky-400 transition-all duration-500"
          style={{
            width: `${coverage}%`,
          }}
        />
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-500">
        Shows how much of the
        applicable production
        readiness surface DeployGuard
        was able to evaluate.
      </p>
    </div>
  );
}

function VerificationChecks({
  checks,
}: {
  checks: CheckResult[];
}) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold">
        Verification Checks
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        {checks.map(
          (check) => (
            <article
              key={check.id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
            >
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {check.name}
                  </p>

                  <p className="mt-2 max-w-md text-sm leading-6 text-zinc-400">
                    {check.summary}
                  </p>
                </div>

                <StatusBadge
                  check={check}
                />
              </div>
            </article>
          )
        )}
      </div>
    </section>
  );
}

function ExternalEvidence({
  research,
  showAll,
  onToggle,
}: {
  research: ResearchSummary;
  showAll: boolean;
  onToggle: () => void;
}) {
  const visibleEvidence =
    showAll
      ? research.evidence
      : research.evidence.slice(
          0,
          3
        );

  return (
    <section className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-zinc-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">
            Live external research
          </p>

          <h2 className="mt-2 text-xl font-semibold">
            External Evidence
          </h2>
        </div>

        <span className="shrink-0 whitespace-nowrap rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
          {
            research.evidence
              .length
          }{" "}
          sources
        </span>
      </div>

      <div className="mt-6 space-y-3">
        {visibleEvidence.map(
          (
            evidence,
            index
          ) => (
            <article
              key={`${evidence.url}-${index}`}
              className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs uppercase tracking-wide text-zinc-400">
                  {
                    evidence.authority
                  }
                </span>

                <span className="text-xs uppercase tracking-wide text-zinc-600">
                  {evidence.sourceType.replace(
                    /_/g,
                    " "
                  )}
                </span>
              </div>

              <a
                href={
                  evidence.url
                }
                target="_blank"
                rel="noreferrer"
                className="mt-3 block break-words font-medium text-zinc-200 transition hover:text-white"
              >
                {
                  evidence.title
                }
              </a>

              {evidence.publisher && (
                <p className="mt-1 text-sm text-zinc-500">
                  {
                    evidence.publisher
                  }
                </p>
              )}
            </article>
          )
        )}
      </div>

      {research.evidence.length >
        3 && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-4 text-sm font-medium text-zinc-400 transition hover:text-white"
        >
          {showAll
            ? "Show fewer sources"
            : `View all ${research.evidence.length} sources`}
        </button>
      )}

      <p className="mt-5 border-t border-zinc-800 pt-4 text-sm leading-6 text-zinc-500">
        External evidence informs
        Nemotron analysis but does
        not directly determine the
        readiness score.
      </p>
    </section>
  );
}

function ArchitectureAnalysis({
  architecture,
}: {
  architecture: NonNullable<
    ReadinessReport["architecture"]
  >;
}) {
  return (
    <section className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-zinc-900 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
          NVIDIA AI
        </span>

        <span className="text-sm text-zinc-500">
          Powered by NVIDIA Nemotron
          3 Super
        </span>
      </div>

      <h2 className="mt-3 text-xl font-semibold">
        AI Architecture Analysis
      </h2>

      <p className="mt-4 leading-7 text-zinc-300">
        {architecture.summary}
      </p>

      <p className="mt-3 text-sm text-zinc-500">
        {
          architecture.architectureType
        }
      </p>
    </section>
  );
}

function RemediationPlan({
  items,
}: {
  items:
    ReadinessReport["remediation"];
}) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold">
        Remediation Plan
      </h2>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
          No remediation items were
          generated.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(
            (
              item,
              index
            ) => (
              <article
                key={`${item.category}-${index}`}
                className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-medium">
                    {item.title}
                  </h3>

                  <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs uppercase tracking-wide text-zinc-400">
                    {
                      item.priority
                    }
                  </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  {
                    item.recommendation
                  }
                </p>
              </article>
            )
          )}
        </div>
      )}
    </section>
  );
}

export function ReadinessDashboard() {
  const [
    repositoryUrl,
    setRepositoryUrl,
  ] = useState("");

  const [
    remoteScan,
    setRemoteScan,
  ] =
    useState<RemoteScanResult | null>(
      null
    );

  const [
    scanLoading,
    setScanLoading,
  ] = useState(false);

  const [
    scanError,
    setScanError,
  ] =
    useState<string | null>(null);

  const [
    showAllResearch,
    setShowAllResearch,
  ] = useState(false);

  const [
    assessment,
    setAssessment,
  ] =
    useState<AssessmentResult | null>(
      null
    );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] =
    useState<string | null>(null);

  const [
    progressEvents,
    setProgressEvents,
  ] = useState<
    AssessmentProgressEvent[]
  >([]);

  const report =
    assessment?.report ?? null;

  const research =
    assessment?.research ?? null;

  const progressByStage =
    useMemo(() => {
      const map =
        new Map<
          string,
          AssessmentProgressEvent
        >();

      for (
        const event of progressEvents
      ) {
        map.set(
          event.stage,
          event
        );
      }

      return map;
    }, [progressEvents]);

  async function scanRepository() {
    setScanLoading(true);
    setScanError(null);
    setRemoteScan(null);

    try {
      const response =
        await fetch(
          "/api/repositories/scan",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              repositoryUrl,
            }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.ok
      ) {
        throw new Error(
          data.error ??
            "Repository scan failed."
        );
      }

      setRemoteScan({
        repository:
          data.repository,
        scan:
          data.scan,
      });
    } catch (scanError) {
      setScanError(
        scanError instanceof Error
          ? scanError.message
          : "Unknown repository scan error."
      );
    } finally {
      setScanLoading(false);
    }
  }

  async function runAssessment() {
    setLoading(true);
    setError(null);
    setAssessment(null);
    setProgressEvents([]);
    setShowAllResearch(false);

    try {
      const response =
        await fetch(
          "/api/assessment",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              repositoryUrl,
            }),
          }
        );

      if (!response.ok) {
        const data =
          await response.json();

        throw new Error(
          data.error ??
            "Assessment failed."
        );
      }

      if (!response.body) {
        throw new Error(
          "Assessment stream is unavailable."
        );
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      let buffer = "";

      let assessmentError:
        string | null = null;

      while (true) {
        const {
          value,
          done,
        } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(
          value,
          {
            stream: true,
          }
        );

        const blocks =
          buffer.split("\n\n");

        buffer =
          blocks.pop() ?? "";

        for (
          const block of blocks
        ) {
          const parsed =
            parseSseBlock(block);

          if (!parsed) {
            continue;
          }

          if (
            parsed.event ===
            "progress"
          ) {
            const progress =
              parsed.data as AssessmentProgressEvent;

            setProgressEvents(
              (current) => [
                ...current,
                progress,
              ]
            );

            continue;
          }

          if (
            parsed.event ===
            "result"
          ) {
            const payload =
              parsed.data as {
                ok: boolean;
                assessment:
                  AssessmentResult;
              };

            if (
              payload.ok &&
              payload.assessment
            ) {
              setAssessment(
                payload.assessment
              );
            }

            continue;
          }

          if (
            parsed.event ===
            "assessment-error"
          ) {
            const payload =
              parsed.data as {
                ok: boolean;
                error?: string;
              };

            assessmentError =
              payload.error ??
              "Assessment failed.";
          }
        }
      }

      if (assessmentError) {
        throw new Error(
          assessmentError
        );
      }
    } catch (
      assessmentError
    ) {
      setError(
        assessmentError instanceof
          Error
          ? assessmentError.message
          : "Unknown assessment error."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-16">
        <header className="mb-12">
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
            DeployGuard AI
          </p>

          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
            Production readiness,
            backed by evidence.
          </h1>

          <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
            DeployGuard executes real
            repository checks inside an
            isolated sandbox, verifies
            the evidence, then uses
            NVIDIA Nemotron to explain
            what is safe to ship and
            what still needs attention.
          </p>

          <ProcessOverview />

          <div className="mt-8 max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <label
              htmlFor="repository-url"
              className="text-sm font-medium text-zinc-300"
            >
              GitHub Repository
            </label>

            <input
              id="repository-url"
              type="url"
              value={
                repositoryUrl
              }
              onChange={(
                event
              ) =>
                setRepositoryUrl(
                  event.target
                    .value
                )
              }
              placeholder="https://github.com/owner/repository"
              disabled={
                loading ||
                scanLoading
              }
              className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-60"
            />

            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={
                  scanRepository
                }
                disabled={
                  scanLoading ||
                  loading ||
                  !repositoryUrl.trim()
                }
                className="rounded-xl border border-zinc-700 px-5 py-3 font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {scanLoading
                  ? "Scanning..."
                  : "Static Scan"}
              </button>

              <button
                type="button"
                onClick={
                  runAssessment
                }
                disabled={
                  loading ||
                  scanLoading ||
                  !repositoryUrl.trim()
                }
                className="rounded-xl bg-white px-5 py-3 font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Assessment running..."
                  : "Assess Repository"}
              </button>
            </div>

            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Static Scan inspects
              repository evidence
              without executing code.
              Full Assessment runs
              isolated verification
              checks inside the
              DeployGuard sandbox.
            </p>

            {scanError && (
              <p className="mt-3 text-sm text-red-400">
                {scanError}
              </p>
            )}

            {error && (
              <p className="mt-3 text-sm text-red-400">
                {error}
              </p>
            )}
          </div>
        </header>

        {(loading ||
          progressEvents.length >
            0) && (
          <AssessmentPipeline
            loading={loading}
            progressByStage={
              progressByStage
            }
          />
        )}

        {remoteScan && (
          <section className="mb-10 space-y-5">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="text-sm text-zinc-500">
                Repository
              </p>

              <h2 className="mt-2 break-words text-xl font-semibold">
                {
                  remoteScan
                    .repository
                    .fullName
                }
              </h2>

              <p className="mt-2 text-sm text-zinc-500">
                Static repository
                evidence collected
                successfully.
              </p>
            </div>

            <div>
              <h2 className="mb-4 text-xl font-semibold">
                Detected Technology
              </h2>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {remoteScan.scan.facts.map(
                  (fact) => (
                    <article
                      key={`${fact.key}-${fact.value}`}
                      className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
                    >
                      <p className="text-xs uppercase tracking-wide text-zinc-500">
                        {fact.key}
                      </p>

                      <p className="mt-2 break-words text-lg font-medium">
                        {
                          fact.value
                        }
                      </p>

                      <p className="mt-2 text-xs text-zinc-600">
                        Confidence{" "}
                        {Math.round(
                          fact.confidence *
                            100
                        )}
                        %
                      </p>
                    </article>
                  )
                )}
              </div>
            </div>

            <div>
              <h2 className="mb-4 text-xl font-semibold">
                Evidence
              </h2>

              <div className="space-y-3">
                {remoteScan.scan.facts.flatMap(
                  (fact) =>
                    fact.evidence.map(
                      (
                        evidence,
                        index
                      ) => (
                        <article
                          key={`${fact.key}-${evidence.path}-${index}`}
                          className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-words font-medium">
                                {
                                  evidence.path
                                }
                              </p>

                              <p className="mt-1 text-sm leading-6 text-zinc-500">
                                {
                                  evidence.description
                                }
                              </p>
                            </div>

                            <span className="shrink-0 whitespace-nowrap rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
                              {
                                fact.key
                              }
                            </span>
                          </div>
                        </article>
                      )
                    )
                )}
              </div>
            </div>
          </section>
        )}

        {report && (
          <div className="space-y-8">
            <section className="grid gap-4 md:grid-cols-2">
              <ReadinessScoreCard
                score={
                  report.readiness
                    .score
                }
              />

              <CoverageCard
                coverage={
                  report.readiness
                    .coverage
                }
              />
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-600">
                Evidence before AI
                opinion
              </p>

              <h2 className="mt-2 text-2xl font-semibold">
                What DeployGuard
                verified
              </h2>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                The readiness score
                below is produced from
                deterministic repository
                and runtime evidence.
                External research and
                NVIDIA Nemotron add
                context and explanation,
                but they do not invent
                the score.
              </p>
            </section>

            <VerificationChecks
              checks={
                report.checks
              }
            />

            {research &&
              research.evidence
                .length > 0 && (
                <ExternalEvidence
                  research={
                    research
                  }
                  showAll={
                    showAllResearch
                  }
                  onToggle={() =>
                    setShowAllResearch(
                      (current) =>
                        !current
                    )
                  }
                />
              )}

            {report.architecture && (
              <ArchitectureAnalysis
                architecture={
                  report.architecture
                }
              />
            )}

            <RemediationPlan
              items={
                report.remediation
              }
            />
          </div>
        )}
      </div>
    </main>
  );
}