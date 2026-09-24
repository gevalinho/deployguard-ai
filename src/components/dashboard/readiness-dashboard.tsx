"use client";

import { useMemo, useState } from "react";
import type {
  PublicCheckResult,
  PublicProductionReadinessReport,
} from "@/lib/reporting/types";

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

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

type CheckResult = PublicCheckResult;
type CheckEvidence = NonNullable<PublicCheckResult["evidence"]>[number];
type ReadinessReport = PublicProductionReadinessReport;

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
  authority: "primary" | "secondary" | "community";
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

type RemediationProofCheck = {
  id: string;
  category: string;
  name: string;
  status: string;
  summary: string;
};

type RemediationResult = {
  repository: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
  };

  remediation: {
    proposal: {
      id: string;
      title: string;
      description: string;

      target: {
        checkId: string;
        category: string;
        evidenceIndexes: number[];
      };

      strategy: "dependency_security" | "lint_autofix";
      risk: "safe" | "breaking_change_allowed";
      packageName?: string;
    };

    execution: {
      status:
        | "proposed"
        | "applied"
        | "failed"
        | "unsupported";
      summary: string;
      durationMs?: number;
    };

    proof?: {
      status:
        | "proven"
        | "not_proven"
        | "inconclusive";

      summary: string;

      comparisons: {
        checkId: string;
        before: RemediationProofCheck;
        after: RemediationProofCheck;
        improved: boolean;
      }[];

            regressionChecks:
        RemediationProofCheck[];

            readinessImpact?: {
        before: {
          score: number;
          coverage: number;
        };

        after: {
          score: number;
          coverage: number;
        };

        delta: number;
      };
    };
  };
};

/* -------------------------------------------------------------------------- */
/*                                  Constants                                 */
/* -------------------------------------------------------------------------- */

const ASSESSMENT_STAGES = [
  { stage: "repository", label: "Repository" },
  { stage: "scan", label: "Repository Scan" },
  { stage: "research", label: "External Research" },
  { stage: "preparation", label: "Sandbox Preparation" },
  { stage: "types", label: "TypeScript" },
  { stage: "lint", label: "Lint" },
  { stage: "test", label: "Tests" },
  { stage: "build", label: "Production Build" },
  { stage: "security", label: "Dependency Security" },
{ stage: "architect", label: "Nemotron Analysis" },
{ stage: "remediation", label: "Nemotron Remediation" },
{ stage: "report", label: "Readiness Report" },
] as const;

const PROCESS_STEPS = [
  {
    step: "01",
    title: "Evidence",
    description: "Inspect the repository and execute real checks.",
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
      "NVIDIA Nemotron reasons over verified evidence.",
  },
  {
    step: "04",
    title: "Readiness",
    description:
      "Calculate a deterministic score and remediation plan.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function getStatusLabel(check: CheckResult) {
  if (
    check.status === "skipped" &&
    check.skipReason === "not_applicable"
  ) {
    return "Not applicable";
  }

  if (
    check.status === "skipped" &&
    check.skipReason === "not_configured"
  ) {
    return "Not configured";
  }

  if (
    check.status === "skipped" &&
    check.skipReason === "unsupported"
  ) {
    return "Unsupported";
  }

  return check.status;
}

function getProgressSymbol(status: AssessmentProgressStatus) {
  switch (status) {
    case "running":
      return "⏳";

    case "passed":
    case "completed":
      return "✓";

    case "blocked":
    case "error":
      return "!";

    case "skipped":
      return "○";

    case "failed":
      return "✕";

    default:
      return "·";
  }
}

function getProgressTextClass(status: AssessmentProgressStatus) {
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

function getCheckStatusClass(check: CheckResult) {
  if (check.status === "passed") {
    return [
      "border-emerald-500/30",
      "bg-emerald-500/10",
      "text-emerald-300",
    ].join(" ");
  }

  if (check.status === "skipped" && check.skipReason === "not_configured") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  }

  if (check.status === "blocked") {
    return [
      "border-amber-500/30",
      "bg-amber-500/10",
      "text-amber-300",
    ].join(" ");
  }

  if (check.status === "failed") {
    return [
      "border-red-500/30",
      "bg-red-500/10",
      "text-red-300",
    ].join(" ");
  }

  if (check.status === "error") {
    return [
      "border-orange-500/30",
      "bg-orange-500/10",
      "text-orange-300",
    ].join(" ");
  }

  return [
    "border-zinc-700",
    "bg-zinc-800/50",
    "text-zinc-400",
  ].join(" ");
}

function getEvidenceKindClass(kind: CheckEvidence["kind"]) {
  switch (kind) {
    case "error":
    case "test_failure":
    case "security_finding":
      return [
        "border-red-500/20",
        "bg-red-500/10",
        "text-red-300",
      ].join(" ");

    case "warning":
      return [
        "border-amber-500/20",
        "bg-amber-500/10",
        "text-amber-300",
      ].join(" ");

    case "diagnostic":
      return [
        "border-sky-500/20",
        "bg-sky-500/10",
        "text-sky-300",
      ].join(" ");
  }
}

function getScoreBarClass(score: number) {
  if (score >= 80) {
    return "bg-emerald-400";
  }

  if (score >= 60) {
    return "bg-amber-400";
  }

  return "bg-red-400";
}

function formatEvidenceKind(kind: CheckEvidence["kind"]) {
  return kind.replace(/_/g, " ");
}

function formatEvidenceLocation(evidence: CheckEvidence) {
  if (!evidence.file) {
    return null;
  }

  let location = evidence.file;

  if (evidence.line !== undefined) {
    location += `:${evidence.line}`;

    if (evidence.column !== undefined) {
      location += `:${evidence.column}`;
    }
  }

  return location;
}

function formatElapsed(elapsedMs?: number) {
  if (elapsedMs === undefined) {
    return "";
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseSseBlock(
  block: string
): {
  event: string;
  data: unknown;
} | null {
  const lines = block.split("\n");

  let event = "message";

  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return {
      event,
      data: JSON.parse(dataLines.join("\n")),
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                              Shared Components                             */
/* -------------------------------------------------------------------------- */

function StatusBadge({ check }: { check: CheckResult }) {
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

function getCheckStateDescription(check: CheckResult) {
  if (check.status === "skipped") {
    switch (check.skipReason) {
      case "not_configured": return "Required configuration is missing; check did not run.";
      case "not_applicable": return "Outside this repository’s applicable assessment scope.";
      case "unsupported": return "This check is not supported for the detected setup.";
      default: return "Check was skipped; no pass or failure was established.";
    }
  }
  switch (check.status) {
    case "passed": return "Check ran and met its verification criteria.";
    case "failed": return "Check ran and found a readiness issue.";
    case "blocked": return "A prerequisite prevented verification.";
    case "error": return "Verification encountered an execution error.";
  }
}

function FindingEvidence({ evidence }: { evidence: CheckEvidence[] }) {
  const prioritized = evidence.filter((item) => item.kind !== "warning");
  const findings = prioritized.length > 0 ? prioritized : evidence;

  return (
    <ul className="mt-3 space-y-3">
      {findings.slice(0, 3).map((item, index) => {
        const location = formatEvidenceLocation(item);
        const isSeverity = item.kind === "security_finding" &&
          /^(critical|high|moderate|medium|low|info)$/i.test(item.code ?? "");
        return (
          <li key={index} className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-sm leading-6 text-zinc-300">{item.message}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
              <span className="capitalize">{formatEvidenceKind(item.kind)}</span>
              {item.code && <span>{isSeverity ? "Severity" : "Code"}: {item.code}</span>}
              {location && <span className="font-mono">File: {location}</span>}
            </div>
          </li>
        );
      })}
      {findings.length > 3 && (
        <li className="text-xs text-zinc-400">
          {findings.length - 3} more findings in Verification Checks.
        </li>
      )}
    </ul>
  );
}

function AssessmentSummary({ report, completion }: {
  report: ReadinessReport;
  completion?: AssessmentProgressEvent;
}) {
  const counts = new Map<string, number>();
  for (const check of report.checks) {
    const label = getStatusLabel(check);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const actions = report.aiRemediation?.actions.length ?? 0;
  const elapsed = completion?.status === "completed" ? completion.elapsedMs : undefined;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-sm font-medium text-zinc-200">Assessment complete</h2>
      <ul aria-label="Assessment summary" className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-300">
        <li className="rounded-full border border-zinc-700 px-3 py-1">{report.checks.length} checks</li>
        {Array.from(counts, ([label, count]) => (
          <li key={label} className="rounded-full border border-zinc-700 px-3 py-1">{count} {label.toLowerCase()}</li>
        ))}
        <li className="rounded-full border border-violet-500/30 px-3 py-1 text-violet-300">
          {actions} verified AI {actions === 1 ? "action" : "actions"}
        </li>
      </ul>
      <p className="mt-3 text-xs leading-5 text-zinc-400">
        {elapsed !== undefined && Number.isFinite(elapsed) && elapsed >= 0 && (
          <span className="mr-2 inline-block">Assessment completed in {(elapsed / 1000).toFixed(1)}s ·</span>
        )}
        Repository evidence verified • AI claims independently checked
      </p>
    </div>
  );
}

function KeyFindings({ checks }: { checks: CheckResult[] }) {
  const failed = checks.filter((check) => check.status === "failed");
  if (failed.length === 0) return null;

  return (
    <section aria-labelledby="key-findings-title" className="rounded-2xl border border-red-500/20 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="key-findings-title" className="text-lg font-semibold">Key Findings</h2>
        <span className="text-xs text-zinc-400">Deterministic evidence · Verified by DeployGuard</span>
      </div>
      <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
        {failed.map((check) => (
          <article key={check.id} className="min-w-0 [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{check.name}</h3>
              <StatusBadge check={check} />
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{check.summary}</p>
            <FindingEvidence evidence={check.evidence ?? []} />
          </article>
        ))}
      </div>
    </section>
  );
}

function ProcessOverview() {
  return (
    <div className="mt-8 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {PROCESS_STEPS.map((item) => (
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
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Assessment Pipeline                             */
/* -------------------------------------------------------------------------- */

function AssessmentPipeline({
  loading,
  progressByStage,
}: {
  loading: boolean;
  progressByStage: Map<string, AssessmentProgressEvent>;
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
        {ASSESSMENT_STAGES.map(({ stage, label }) => {
          const progress = progressByStage.get(stage);
          const status = progress?.status ?? "pending";

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
                {getProgressSymbol(status)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">
                    {label}
                  </p>

                  {progress?.elapsedMs !== undefined && (
                    <span className="font-mono text-xs text-zinc-600">
                      {formatElapsed(progress.elapsedMs)}
                    </span>
                  )}
                </div>

                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  {progress?.message ??
                    (status === "pending" ? "Waiting..." : "")}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Score Cards                                 */
/* -------------------------------------------------------------------------- */

function ReadinessScoreCard({ score }: { score: number }) {
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
          style={{ width: `${score}%` }}
        />
      </div>

      <p className="mt-4 text-sm font-medium leading-6 text-zinc-300">
        Score reflects verified readiness only. Blocked and
        unconfigured areas do not receive readiness credit.
      </p>

      <p className="mt-2 text-sm leading-6 text-zinc-500">
        Calculated from verified build, type, lint, test,
        security, database, deployment and environment evidence —
        not from an AI opinion.
      </p>
    </div>
  );
}

function CoverageCard({ coverage }: { coverage: number }) {
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
          style={{ width: `${coverage}%` }}
        />
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-500">
        Shows how much of the applicable production readiness
        surface DeployGuard was able to evaluate.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                         Verification / Check Evidence                      */
/* -------------------------------------------------------------------------- */

function VerificationChecks({
  checks,
}: {
  checks: CheckResult[];
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl font-semibold">
          Verification Checks
        </h2>

        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Deterministic findings captured directly from repository
          analysis and isolated sandbox execution.
        </p>
      </div>

      <div className="grid items-start gap-4 md:grid-cols-2">
        {checks.map((check) => {
          const evidence = check.evidence ?? [];

          return (
            <article
              key={check.id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {check.name}
                  </p>

                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    {check.summary}
                  </p>
                </div>

                <StatusBadge check={check} />
              </div>

              <p className="mt-3 text-xs leading-5 text-zinc-400">
                {getCheckStateDescription(check)}
              </p>

              {evidence.length > 0 && (
                <div className="mt-5 border-t border-zinc-800 pt-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                      Captured Evidence
                    </p>

                    <span className="font-mono text-xs text-zinc-600">
                      {evidence.length}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {evidence.map((item, index) => {
                      const location =
                        formatEvidenceLocation(item);

                      return (
                        <div
                          key={`${check.id}-evidence-${index}`}
                          className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ${getEvidenceKindClass(
                                item.kind
                              )}`}
                            >
                              {formatEvidenceKind(item.kind)}
                            </span>

                            {item.code && (
                              <span className="rounded-full border border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-zinc-400">
                                {item.code}
                              </span>
                            )}
                          </div>

                          {location && (
                            <p className="mt-3 break-all font-mono text-xs leading-5 text-zinc-500">
                              {location}
                            </p>
                          )}

                          <p className="mt-2 break-words text-sm leading-6 text-zinc-300">
                            {item.message}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                            External Evidence                               */
/* -------------------------------------------------------------------------- */

function ExternalEvidence({
  research,
  showAll,
  onToggle,
}: {
  research: ResearchSummary;
  showAll: boolean;
  onToggle: () => void;
}) {
  const visibleEvidence = showAll
    ? research.evidence
    : research.evidence.slice(0, 3);

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
          {research.evidence.length} sources
        </span>
      </div>

      <div className="mt-6 space-y-3">
        {visibleEvidence.map((evidence, index) => (
          <article
            key={`${evidence.url}-${index}`}
            className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs uppercase tracking-wide text-zinc-400">
                {evidence.authority}
              </span>

              <span className="text-xs uppercase tracking-wide text-zinc-600">
                {evidence.sourceType.replace(/_/g, " ")}
              </span>
            </div>

            <a
              href={evidence.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block break-words font-medium text-zinc-200 transition hover:text-white"
            >
              {evidence.title}
            </a>

            {evidence.publisher && (
              <p className="mt-1 text-sm text-zinc-500">
                {evidence.publisher}
              </p>
            )}
          </article>
        ))}
      </div>

      {research.evidence.length > 3 && (
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
        External evidence informs Nemotron analysis but does not
        directly determine the readiness score.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Nemotron Analysis                             */
/* -------------------------------------------------------------------------- */

function ArchitectureAnalysis({
  architecture,
}: {
  architecture: NonNullable<ReadinessReport["architecture"]>;
}) {
  return (
    <section className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-zinc-900 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
          NVIDIA AI
        </span>

        <span className="text-sm text-zinc-500">
          Powered by NVIDIA Nemotron 3 Super
        </span>
      </div>

      <h2 className="mt-3 text-xl font-semibold">
        AI Architecture Analysis
      </h2>

      <p className="mt-3 text-sm leading-6 text-zinc-400">
        Nemotron reasons over verified evidence. DeployGuard executes checks and calculates the deterministic readiness score.
      </p>
      <p className="mt-4 leading-7 text-zinc-300">
        {architecture.summary}
      </p>

      <p className="mt-3 text-sm text-zinc-500">
        {architecture.architectureType}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Remediation Plan                              */
/* -------------------------------------------------------------------------- */

function RemediationPlan({
  items,
  checks,
}: {
  items: ReadinessReport["remediation"];
  checks: CheckResult[];
}) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold">
        Remediation Plan
      </h2>

      <p className="mb-4 text-sm text-zinc-400">Deterministic recommendations from check outcomes and repository evidence.</p>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
          No remediation items were generated.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <article
              key={`${item.category}-${index}`}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-medium">
                  {item.title}
                </h3>

                <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs uppercase tracking-wide text-zinc-400">
                  {item.priority}
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-zinc-400">
                {item.recommendation}
              </p>
              {checks.filter((check) => check.category === item.category && check.status === "failed" && check.evidence?.length).map((check) => (
                <div key={check.id} className="mt-4 min-w-0 border-t border-zinc-800 pt-3 [overflow-wrap:anywhere]">
                  <p className="text-xs font-medium text-zinc-400">Verified evidence · {check.name}</p>
                  <FindingEvidence evidence={check.evidence ?? []} />
                </div>
              ))}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}


/* -------------------------------------------------------------------------- */
/*                           AI Remediation Guidance                           */
/* -------------------------------------------------------------------------- */

function AiRemediationGuidance({
  remediation,
  checks,
  onExecute,
  executing,
}: {
  remediation: NonNullable<
    ReadinessReport["aiRemediation"]
  >;

  checks: CheckResult[];

  onExecute: (
    action: NonNullable<
      ReadinessReport["aiRemediation"]
    >["actions"][number]
  ) => Promise<void>;

  executing: boolean;
}) {
  const checksById = new Map(
    checks.map((check) => [check.id, check])
  );

  const executableActions =
  remediation.actions.filter((action) => {
    const check =
      checksById.get(action.checkId);

    if (
      !check ||
      check.status !== "failed"
    ) {
      return false;
    }

    const referencedEvidence =
      action.evidenceIndexes
        .map(
          (index) =>
            check.evidence?.[index]
        )
        .filter(
          (
            evidence
          ): evidence is CheckEvidence =>
            evidence !== undefined
        );

    if (
      action.checkId === "security" &&
      check.category === "security"
    ) {
      return referencedEvidence.some(
        (evidence) =>
          evidence.kind ===
          "security_finding"
      );
    }

    if (
      action.checkId === "lint" &&
      check.category === "lint"
    ) {
      return referencedEvidence.some(
        (evidence) =>
          evidence.kind === "error" ||
          evidence.kind === "warning"
      );
    }

    return false;
  });

const uniqueExecutableActions =
  Array.from(
    new Map(
      executableActions.map(
        (action) => [
          action.checkId,
          action,
        ]
      )
    ).values()
  );

  return (
    <section className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-zinc-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
              NVIDIA AI
            </span>

            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              Evidence verified
            </span>
          </div>

          <h2 className="mt-4 text-xl font-semibold">
            AI Remediation Guidance
          </h2>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
            Nemotron explains verified failures using structured
            evidence captured by DeployGuard. Every displayed
            evidence reference passed deterministic verification.
          </p>
        </div>

        <span className="shrink-0 whitespace-nowrap rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
          {remediation.actions.length} verified{" "}
          {remediation.actions.length === 1
            ? "action"
            : "actions"}
        </span>
      </div>

      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">
          Nemotron Summary
        </p>

        <p className="mt-2 text-sm leading-6 text-zinc-300">
          {remediation.summary}
        </p>
      </div>

      <div className="mt-5 space-y-4">
        {remediation.actions.map((action, actionIndex) => {
          const check = checksById.get(action.checkId);

         
          const referencedEvidence =
            check?.evidence
              ? action.evidenceIndexes
                  .map((index) => ({
                    index,
                    evidence: check.evidence?.[index],
                  }))
                  .filter(
                    (
                      item
                    ): item is {
                      index: number;
                      evidence: CheckEvidence;
                    } => item.evidence !== undefined
                  )
              : [];

  


          return (
            <article
              key={`${action.checkId}-${actionIndex}`}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-600">
                    {check?.name ?? action.checkId}
                  </p>

                  <h3 className="mt-2 font-medium text-zinc-100">
                    {action.title}
                  </h3>
                </div>

                <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs uppercase tracking-wide text-zinc-400">
                  {action.priority}
                </span>
              </div>

              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">
                  Explanation
                </p>

                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {action.explanation}
                </p>
              </div>

              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">
                  Recommendation
                </p>

                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  {action.recommendation}
                </p>
              </div>

              {referencedEvidence.length > 0 && (
                <div className="mt-5 border-t border-zinc-800 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">
                      Verified Evidence References
                    </p>

                    <span className="text-xs font-medium text-emerald-400">
                      ✓ References verified
                    </span>
                  </div>

                  <div className="mt-3 space-y-3">
                    {referencedEvidence.map(
                      ({ index, evidence }) => {
                        const location =
                          formatEvidenceLocation(evidence);

                        return (
                          <div
                            key={`${action.checkId}-${actionIndex}-evidence-${index}`}
                            className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs text-zinc-600">
                                Evidence #{index}
                              </span>

                              <span
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ${getEvidenceKindClass(
                                  evidence.kind
                                )}`}
                              >
                                {formatEvidenceKind(
                                  evidence.kind
                                )}
                              </span>

                              {evidence.code && (
                                <span className="rounded-full border border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-zinc-400">
                                  {evidence.code}
                                </span>
                              )}
                            </div>

                            {location && (
                              <p className="mt-3 break-all font-mono text-xs leading-5 text-zinc-500">
                                {location}
                              </p>
                            )}

                            <p className="mt-2 break-words text-sm leading-6 text-zinc-300">
                              {evidence.message}
                            </p>
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              )}

              {referencedEvidence.length === 0 && (
                <p className="mt-5 border-t border-zinc-800 pt-4 text-xs leading-5 text-zinc-600">
                  This guidance concerns a verification limitation
                  without structured diagnostic evidence.
                </p>
              )}
            
            </article>
          );
        })}
      </div>

      {uniqueExecutableActions.length > 0 && (
  <div className="mt-6 rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5">
    <p className="text-xs font-medium uppercase tracking-[0.16em] text-violet-300">
      Controlled Remediation
    </p>

    <h3 className="mt-2 font-medium text-zinc-100">
      Verified automated remediation available
    </h3>

    <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
      DeployGuard can apply deterministic remediation
      for the verified checks below and independently
      re-run verification before claiming success.
    </p>

    <div className="mt-4 flex flex-wrap gap-3">
      {uniqueExecutableActions.map((action) => {
        const check =
          checksById.get(action.checkId);

        return (
          <button
            key={action.checkId}
            type="button"
            disabled={executing}
            onClick={() =>
              void onExecute(action)
            }
            className="rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-2.5 text-sm font-medium text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {executing
              ? "Running controlled remediation..."
              : `Remediate ${check?.name ?? action.checkId}`}
          </button>
        );
      })}
    </div>

    <p className="mt-3 text-xs leading-5 text-zinc-500">
      Remediation runs against a disposable DeployGuard
      workspace. Your GitHub repository is not modified.
    </p>
  </div>
)}

      <p className="mt-5 border-t border-zinc-800 pt-4 text-xs leading-5 text-zinc-500">
        AI remediation is advisory. It does not modify the
        deterministic readiness score or claim that a suggested
        change has been executed.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Dashboard                                  */
/* -------------------------------------------------------------------------- */


function RemediationProof({
  result,
}: {
  result: RemediationResult;
}) {
  const remediation = result.remediation;
  const proof = remediation.proof;

  const proven =
    proof?.status === "proven";

  const readinessImpact =
    proof?.readinessImpact;

  const comparisons =
    proof?.comparisons ?? [];

  const regressionChecks =
    proof?.regressionChecks ?? [];

  const regressionPassed =
    regressionChecks.length > 0 &&
    regressionChecks.every(
      (check) =>
        check.status === "passed"
    );

  const isLintRemediation =
  remediation.proposal.strategy ===
  "lint_autofix";

const targetImproved =
  comparisons.length > 0 &&
  comparisons.every(
    (comparison) =>
      comparison.improved
  );

const stages = [
  {
    label: isLintRemediation
      ? "Lint failure detected"
      : "Vulnerability detected",
    complete:
      comparisons.length > 0,
  },
  {
    label: "Controlled fix applied",
    complete:
      remediation.execution.status ===
      "applied",
  },
  {
  label: "Available regression checks passed",
  complete: regressionPassed,
  },
  {
    label: isLintRemediation
      ? "Lint re-verified"
      : "Security re-verified",
    complete: targetImproved,
  },
  {
    label: "Remediation proven",
    complete: proven,
  },
];

  return (
    <section
      className={`overflow-hidden rounded-2xl border ${
        proven
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-amber-500/30 bg-amber-500/5"
      }`}
    >
      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
              Controlled Remediation
            </p>

            <h2 className="mt-2 text-2xl font-semibold">
              {proven
                ? "Remediation Proven"
                : "Remediation Result"}
            </h2>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              {proof?.summary ??
                remediation.execution.summary}
            </p>
          </div>

          <span
            className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide ${
              proven
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            {proof?.status ??
              remediation.execution.status}
          </span>
        </div>

        {/* Proof lifecycle */}

        <div className="mt-8">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">
            Verification Lifecycle
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            {stages.map(
              (stage, index) => (
                <div
                  key={stage.label}
                  className={`relative rounded-xl border p-4 ${
                    stage.complete
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-zinc-800 bg-zinc-950/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                        stage.complete
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-zinc-700 text-zinc-600"
                      }`}
                    >
                      {stage.complete
                        ? "✓"
                        : index + 1}
                    </span>

                    <span className="text-xs text-zinc-500">
                      Step {index + 1}
                    </span>
                  </div>

                  <p
                    className={`mt-3 text-sm font-medium leading-5 ${
                      stage.complete
                        ? "text-zinc-200"
                        : "text-zinc-500"
                    }`}
                  >
                    {stage.label}
                  </p>
                </div>
              )
            )}
          </div>
        </div>

        {/* Before / after evidence */}

        {comparisons.length > 0 && (
          <div className="mt-8">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">
              Before / After Verification
            </p>

            <div className="mt-4 space-y-4">
              {comparisons.map(
                (comparison) => (
                  <article
                    key={
                      comparison.checkId
                    }
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-medium text-zinc-200">
                        {
                          comparison.before
                            .name
                        }
                      </h3>

                      {comparison.improved && (
                        <span className="text-xs font-medium text-emerald-400">
                          ✓ Verified improvement
                        </span>
                      )}
                    </div>

                    <div className="mt-5 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
                      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-red-400/70">
                          Before
                        </p>

                        <p className="mt-2 text-lg font-semibold capitalize text-red-300">
                          {
                            comparison.before
                              .status
                          }
                        </p>

                        <p className="mt-2 text-xs leading-5 text-zinc-500">
                          {
                            comparison.before
                              .summary
                          }
                        </p>
                      </div>

                      <div className="flex items-center justify-center px-2 text-xl text-zinc-600">
                        →
                      </div>

                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-emerald-400/70">
                          After
                        </p>

                        <p className="mt-2 text-lg font-semibold capitalize text-emerald-300">
                          {
                            comparison.after
                              .status
                          }
                        </p>

                        <p className="mt-2 text-xs leading-5 text-zinc-500">
                          {
                            comparison.after
                              .summary
                          }
                        </p>
                      </div>
                    </div>
                  </article>
                )
              )}
            </div>
          </div>
        )}

        {/* Regression safety */}

        {regressionChecks.length >
          0 && (
          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">
                Regression Safety
              </p>

              {regressionPassed && (
                <span className="text-xs font-medium text-emerald-400">
                  ✓ Available regression checks passed
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {regressionChecks.map(
                (check) => (
                  <div
                    key={check.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
                  >
                    <p className="text-sm font-medium text-zinc-200">
                      {check.name}
                    </p>

                    <p
                      className={`mt-2 text-xs font-medium uppercase ${
                        check.status ===
                        "passed"
                          ? "text-emerald-400"
                          : "text-amber-400"
                      }`}
                    >
                      {check.status ===
                      "passed"
                        ? "✓ "
                        : ""}
                      {check.status}
                    </p>

                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      {check.summary}
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        )}

                {/* Deterministic readiness impact */}

                {/* Deterministic readiness impact */}

        {readinessImpact && (
          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">
                Deterministic Readiness Impact
              </p>

              {readinessImpact.delta > 0 && (
                <span className="text-xs font-medium text-emerald-400">
                  ✓ Readiness improved
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-600">
                  Before
                </p>

                <p className="mt-2 text-2xl font-semibold text-zinc-200">
                  {readinessImpact.before.score}
                  <span className="text-sm text-zinc-600">
                    /100
                  </span>
                </p>

                <p className="mt-2 text-xs text-zinc-500">
                  Coverage{" "}
                  {readinessImpact.before.coverage}%
                </p>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-emerald-400/70">
                  After
                </p>

                <p className="mt-2 text-2xl font-semibold text-emerald-300">
                  {readinessImpact.after.score}
                  <span className="text-sm text-zinc-600">
                    /100
                  </span>
                </p>

                <p className="mt-2 text-xs text-zinc-500">
                  Coverage{" "}
                  {readinessImpact.after.coverage}%
                </p>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-emerald-400/70">
                  Score Change
                </p>

                <p
                  className={`mt-2 text-2xl font-semibold ${
                    readinessImpact.delta > 0
                      ? "text-emerald-300"
                      : readinessImpact.delta < 0
                        ? "text-red-300"
                        : "text-zinc-300"
                  }`}
                >
                  {readinessImpact.delta > 0
                    ? "+"
                    : ""}
                  {readinessImpact.delta}
                </p>

                <p className="mt-2 text-xs text-zinc-500">
                  Deterministic delta
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Recalculated deterministically from verified
              post-remediation checks. AI does not modify
              this score.
            </p>
          </div>
        )}
      </div>

      {/* Trust boundary */}

      <div className="border-t border-zinc-800 bg-zinc-950/40 px-6 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-emerald-400">
            ✓
          </span>

          <div>
            <p className="text-xs font-medium text-zinc-300">
              Source repository protected
            </p>

            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Remediation was executed inside a
              disposable DeployGuard workspace.
              The source GitHub repository was
              not modified.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ReadinessDashboard() {
  const [repositoryUrl, setRepositoryUrl] = useState("");

  const [remoteScan, setRemoteScan] =
    useState<RemoteScanResult | null>(null);

  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [showAllResearch, setShowAllResearch] = useState(false);

  const [assessment, setAssessment] =
    useState<AssessmentResult | null>(null);

  const [remediationLoading, setRemediationLoading] =
  useState(false);

const [remediationError, setRemediationError] =
  useState<string | null>(null);

const [remediationResult, setRemediationResult] =
  useState<RemediationResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [progressEvents, setProgressEvents] = useState<
    AssessmentProgressEvent[]
  >([]);

  const report = assessment?.report ?? null;
  const research = assessment?.research ?? null;

  const progressByStage = useMemo(() => {
    const map = new Map<string, AssessmentProgressEvent>();

    for (const event of progressEvents) {
      map.set(event.stage, event);
    }

    return map;
  }, [progressEvents]);

  async function scanRepository() {
    setScanLoading(true);
    setScanError(null);
    setRemoteScan(null);

    try {
      const response = await fetch("/api/repositories/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repositoryUrl,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ?? "Repository scan failed."
        );
      }

      setRemoteScan({
        repository: data.repository,
        scan: data.scan,
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
    setRemediationResult(null);
    setRemediationError(null);

    try {
      const response = await fetch("/api/assessment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repositoryUrl,
        }),
      });

      if (!response.ok) {
        const data = await response.json();

        throw new Error(
          data.error ?? "Assessment failed."
        );
      }

      if (!response.body) {
        throw new Error(
          "Assessment stream is unavailable."
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      let assessmentError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, {
          stream: true,
        });

        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const parsed = parseSseBlock(block);

          if (!parsed) {
            continue;
          }

          if (parsed.event === "progress") {
            const progress =
              parsed.data as AssessmentProgressEvent;

            setProgressEvents((current) => [
              ...current,
              progress,
            ]);

            continue;
          }

          if (parsed.event === "result") {
            const payload = parsed.data as {
              ok: boolean;
              assessment: AssessmentResult;
            };

            if (payload.ok && payload.assessment) {
              setAssessment(payload.assessment);
            }

            continue;
          }

          if (parsed.event === "assessment-error") {
            const payload = parsed.data as {
              ok: boolean;
              error?: string;
            };

            assessmentError =
              payload.error ?? "Assessment failed.";
          }
        }
      }

      if (assessmentError) {
        throw new Error(assessmentError);
      }
    } catch (assessmentError) {
      setError(
        assessmentError instanceof Error
          ? assessmentError.message
          : "Unknown assessment error."
      );
    } finally {
      setLoading(false);
    }
  }

  async function runControlledRemediation(
    action: NonNullable<
      ReadinessReport["aiRemediation"]
    >["actions"][number]
  ) {
    setRemediationLoading(true);
    setRemediationError(null);
    setRemediationResult(null);

    try {
      const check = report?.checks.find(
        (item) => item.id === action.checkId
      );

      if (!check) {
        throw new Error(
          "The remediation target check could not be found."
        );
      }

      const isDependencySecurity =
        action.checkId === "security" &&
        check.category === "security";

      const isLintAutofix =
        action.checkId === "lint" &&
        check.category === "lint";

      if (!isDependencySecurity && !isLintAutofix) {
        throw new Error(
          "No controlled remediation strategy is available for this check."
        );
      }

      const referencedEvidence =
        action.evidenceIndexes
          .map((index) => check.evidence?.[index])
          .filter(
            (evidence): evidence is CheckEvidence =>
              evidence !== undefined
          );

      let proposal;

      if (isDependencySecurity) {
        const securityFinding = referencedEvidence.find(
          (evidence) => evidence.kind === "security_finding"
        );

        if (!securityFinding) {
          throw new Error(
            "No verified dependency security finding was available for this remediation."
          );
        }

        const packageName = securityFinding.message.match(
          /^(.+?) has a (?:high|critical)-severity dependency vulnerability\.$/i
        )?.[1];

        if (!packageName) {
          throw new Error(
            "DeployGuard could not determine the affected package from verified evidence."
          );
        }

        proposal = {
          id: `dependency-security-${packageName}`,
          title: `Remediate ${packageName} vulnerability`,
          description:
            "Apply controlled dependency security remediation and verify the result.",
          target: {
            checkId: action.checkId,
            category: check.category,
            evidenceIndexes: action.evidenceIndexes,
          },
          strategy: "dependency_security" as const,
          risk: "breaking_change_allowed" as const,
          packageName,
        };
      } else {
        if (referencedEvidence.length === 0) {
          throw new Error(
            "No verified lint evidence was available for this remediation."
          );
        }

        proposal = {
          id: "lint-autofix",
          title: "Apply controlled lint autofix",
          description:
            "Apply deterministic ESLint autofix and independently verify the result.",
          target: {
            checkId: action.checkId,
            category: check.category,
            evidenceIndexes: action.evidenceIndexes,
          },
          strategy: "lint_autofix" as const,
          risk: "safe" as const,
        };
      }

      const response = await fetch("/api/remediation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repositoryUrl,
          proposal,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error ?? "Controlled remediation failed."
        );
      }

      setRemediationResult(data.remediation);
    } catch (remediationError) {
      setRemediationError(
        remediationError instanceof Error
          ? remediationError.message
          : "Unknown remediation error."
      );
    } finally {
      setRemediationLoading(false);
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
            Production readiness, backed by evidence.
          </h1>

          <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
            DeployGuard executes real repository checks inside an
            isolated sandbox, verifies the evidence, then uses NVIDIA
            Nemotron to explain what is safe to ship and what still
            needs attention.
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
              value={repositoryUrl}
              onChange={(event) =>
                setRepositoryUrl(event.target.value)
              }
              placeholder="https://github.com/owner/repository"
              disabled={loading || scanLoading}
              className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-60"
            />

            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={scanRepository}
                disabled={
                  scanLoading ||
                  loading ||
                  !repositoryUrl.trim()
                }
                className="rounded-xl border border-zinc-700 px-5 py-3 font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {scanLoading ? "Scanning..." : "Static Scan"}
              </button>

              <button
                type="button"
                onClick={runAssessment}
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
              Static Scan inspects repository evidence without
              executing code. Full Assessment runs isolated
              verification checks inside the DeployGuard sandbox.
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

        {(loading || progressEvents.length > 0) && (
          <AssessmentPipeline
            loading={loading}
            progressByStage={progressByStage}
          />
        )}

        {remoteScan && (
          <section className="mb-10 space-y-5">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="text-sm text-zinc-500">
                Repository
              </p>

              <h2 className="mt-2 break-words text-xl font-semibold">
                {remoteScan.repository.fullName}
              </h2>

              <p className="mt-2 text-sm text-zinc-500">
                Static repository evidence collected successfully.
              </p>
            </div>

            <div>
              <h2 className="mb-4 text-xl font-semibold">
                Detected Technology
              </h2>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {remoteScan.scan.facts.map((fact) => (
                  <article
                    key={`${fact.key}-${fact.value}`}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
                  >
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      {fact.key}
                    </p>

                    <p className="mt-2 break-words text-lg font-medium">
                      {fact.value}
                    </p>

                    <p className="mt-2 text-xs text-zinc-600">
                      Confidence{" "}
                      {Math.round(fact.confidence * 100)}%
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div>
              <h2 className="mb-4 text-xl font-semibold">
                Evidence
              </h2>

              <div className="space-y-3">
                {remoteScan.scan.facts.flatMap((fact) =>
                  fact.evidence.map((evidence, index) => (
                    <article
                      key={`${fact.key}-${evidence.path}-${index}`}
                      className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words font-medium">
                            {evidence.path}
                          </p>

                          <p className="mt-1 text-sm leading-6 text-zinc-500">
                            {evidence.description}
                          </p>
                        </div>

                        <span className="shrink-0 whitespace-nowrap rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
                          {fact.key}
                        </span>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {report && (
          <div className="min-w-0 space-y-8 [overflow-wrap:anywhere]">
            <section className="grid gap-4 md:grid-cols-2">
              <ReadinessScoreCard
                score={report.readiness.score}
              />

              <CoverageCard
                coverage={report.readiness.coverage}
              />
            </section>

            <AssessmentSummary report={report} completion={progressByStage.get("report")} />
            <KeyFindings checks={report.checks} />

            <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-600">
                Evidence before AI opinion
              </p>

              <h2 className="mt-2 text-2xl font-semibold">
                What DeployGuard verified
              </h2>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                The readiness score above is produced from
                deterministic repository and runtime evidence.
                External research and NVIDIA Nemotron add context and
                explanation, but they do not invent the score.
              </p>
            </section>

            <VerificationChecks checks={report.checks} />

            {research && research.evidence.length > 0 && (
              <ExternalEvidence
                research={research}
                showAll={showAllResearch}
                onToggle={() =>
                  setShowAllResearch(
                    (current) => !current
                  )
                }
              />
            )}

            {report.architecture && (
              <ArchitectureAnalysis
                architecture={report.architecture}
              />
            )}

            <RemediationPlan
  items={report.remediation}
  checks={report.checks}
/>

{report.aiRemediation &&
  report.aiRemediation.actions.length > 0 && (
       <AiRemediationGuidance
  remediation={report.aiRemediation}
  checks={report.checks}
  onExecute={runControlledRemediation}
  executing={remediationLoading}
/>
  )}

  {remediationError && (
  <section className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
    <p className="font-medium text-red-300">
      Controlled remediation failed
    </p>

    <p className="mt-2 text-sm text-red-200/70">
      {remediationError}
    </p>
  </section>
)}

{remediationResult && (
  <RemediationProof
    result={remediationResult}
  />
)}
          </div>
        )}
      </div>
    </main>
  );
}