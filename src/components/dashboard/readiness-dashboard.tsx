"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RemediationDelivery } from "./remediation-delivery";
import { controlledRemediationCandidateKey, getControlledRemediationCandidates, type ControlledRemediationCandidate } from "@/lib/remediation/controlled-candidates";
import { currentAssessmentArtifact } from "@/lib/remediation/current-assessment-artifact";
import type {
  PublicCheckResult,
  PublicProductionReadinessReport,
} from "@/lib/reporting/types";
import { ReadinessBreakdown } from "@/components/dashboard/readiness-breakdown";
import { parseGitHubRepositoryUrl } from "@/lib/repository/github-repository";
import { serializeAiContext, serializeFinding, writeShareText } from "./assessment-share";

export function repositoryIdentity(value: string): string | null {
  try {
    return parseGitHubRepositoryUrl(value).fullName.toLowerCase();
  } catch {
    return null;
  }
}

export function shouldInvalidateRepository(previousIdentity: string | null, value: string): boolean {
  const nextIdentity = repositoryIdentity(value);
  return nextIdentity !== previousIdentity || (nextIdentity === null && Boolean(value.trim()));
}

export function isCurrentRequest(
  generation: number, activeGeneration: number,
  requestedIdentity: string | null, activeIdentity: string | null,
  aborted: boolean,
): boolean {
  return generation === activeGeneration && requestedIdentity === activeIdentity && !aborted;
}

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
  sourceCommitSha?: string;
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
  sourceCommitSha?: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
  };

  remediation: {
    verifiedArtifactReference?: { artifactId: string; deliveryEligible?: boolean };
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
      advisoryId?: string;
    };

    execution: {
      status: "proposed" | "applied" | "failed" | "unsupported";
      summary: string;
      durationMs?: number;
    };

    proof?: {
      status: "proven" | "not_proven" | "inconclusive";

      summary: string;

      comparisons: {
        checkId: string;
        before: RemediationProofCheck;
        after: RemediationProofCheck;
        improved: boolean;
      }[];

      regressionChecks: RemediationProofCheck[];

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

    verifiedPatch?: {
      fileCount: number;

      files: {
        path: string;

        changeType: "added" | "modified" | "deleted";
      }[];
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
    description: "Validate build, types, tests, security and deployment.",
  },
  {
    step: "03",
    title: "AI Reasoning",
    description: "NVIDIA Nemotron reasons over verified evidence.",
  },
  {
    step: "04",
    title: "Readiness",
    description: "Calculate a deterministic score and remediation plan.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function getStatusLabel(check: CheckResult) {
  if (check.status === "skipped" && check.skipReason === "not_applicable") {
    return "Not applicable";
  }

  if (check.status === "skipped" && check.skipReason === "not_configured") {
    return "Not configured";
  }

  if (check.status === "skipped" && check.skipReason === "unsupported") {
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
      return "text-zinc-400";
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
    return ["border-amber-500/30", "bg-amber-500/10", "text-amber-300"].join(
      " ",
    );
  }

  if (check.status === "failed") {
    return ["border-red-500/30", "bg-red-500/10", "text-red-300"].join(" ");
  }

  if (check.status === "error") {
    return ["border-orange-500/30", "bg-orange-500/10", "text-orange-300"].join(
      " ",
    );
  }

  return ["border-zinc-700", "bg-zinc-800/50", "text-zinc-400"].join(" ");
}

function getEvidenceKindClass(kind: CheckEvidence["kind"]) {
  switch (kind) {
    case "error":
    case "test_failure":
    case "security_finding":
      return ["border-red-500/20", "bg-red-500/10", "text-red-300"].join(" ");

    case "warning":
      return ["border-amber-500/20", "bg-amber-500/10", "text-amber-300"].join(
        " ",
      );

    case "diagnostic":
      return ["border-sky-500/20", "bg-sky-500/10", "text-sky-300"].join(" ");
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

function formatDependencyScope(evidence: CheckEvidence) {
  if (evidence.kind !== "security_finding" || !evidence.dependencyScope) {
    return null;
  }

  switch (evidence.dependencyScope) {
    case "production":
      return "Production dependency";
    case "development":
      return "Development dependency";
    case "both":
      return "Production and development";
    case "unknown":
      return "Exposure unknown";
  }
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

function parseSseBlock(block: string): {
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
        check,
      )}`}
    >
      {getStatusLabel(check)}
    </span>
  );
}

function getCheckStateDescription(check: CheckResult) {
  if (check.status === "skipped") {
    switch (check.skipReason) {
      case "not_configured":
        return "No recognized configuration was detected for this capability. The check did not run.";
      case "not_applicable":
        return "Outside this repository’s applicable assessment scope.";
      case "unsupported":
        return "This check is not supported for the detected setup.";
      default:
        return "Check was skipped; no pass or failure was established.";
    }
  }
  switch (check.status) {
    case "passed":
      return "Check ran and met its verification criteria.";
    case "failed":
      return "Verified check failed.";
    case "blocked":
      return "Verification could not complete because the DeployGuard sandbox or an external dependency blocked execution.";
    case "error":
      return "Verification encountered an execution error.";
  }
}

export function FindingEvidence({ evidence }: { evidence: CheckEvidence[] }) {
  const prioritized = evidence.filter((item) => item.kind !== "warning");
  const findings = prioritized.length > 0 ? prioritized : evidence;
  if (findings.length === 0) return null;

  return (
    <details className="mt-3 rounded-lg border border-zinc-800/80 p-2">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-zinc-200 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">
        View evidence ({findings.length})
      </summary>
      <ul className="mt-2 space-y-3">
      {findings.slice(0, 3).map((item, index) => {
        const location = formatEvidenceLocation(item);
        const isSeverity =
          item.kind === "security_finding" &&
          /^(critical|high|moderate|medium|low|info)$/i.test(item.code ?? "");
        return (
          <li
            key={index}
            className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"
          >
            <p className="text-sm leading-6 text-zinc-300">{item.message}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
              <span className="capitalize">
                {formatEvidenceKind(item.kind)}
              </span>
              {item.code && (
                <span>
                  {isSeverity ? "Severity" : "Code"}: {item.code}
                </span>
              )}
              {formatDependencyScope(item) && (
                <span>Exposure: {formatDependencyScope(item)}</span>
              )}
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
    </details>
  );
}

function AssessmentSummary({
  report,
  completion,
}: {
  report: ReadinessReport;
  completion?: AssessmentProgressEvent;
}) {
  const counts = new Map<string, number>();
  for (const check of report.checks) {
    const label = getStatusLabel(check);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const actions = report.aiRemediation?.actions.length ?? 0;
  const elapsed =
    completion?.status === "completed" ? completion.elapsedMs : undefined;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-sm font-medium text-zinc-200">Assessment complete</h2>
      <ul
        aria-label="Assessment summary"
        className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-300"
      >
        <li className="rounded-full border border-zinc-700 px-3 py-1">
          {report.checks.length} checks
        </li>
        {Array.from(counts, ([label, count]) => (
          <li
            key={label}
            className="rounded-full border border-zinc-700 px-3 py-1"
          >
            {count} {label.toLowerCase()}
          </li>
        ))}
        <li className="rounded-full border border-violet-500/30 px-3 py-1 text-violet-300">
          {actions} verified AI {actions === 1 ? "action" : "actions"}
        </li>
      </ul>
      <p className="mt-3 text-xs leading-5 text-zinc-400">
        {elapsed !== undefined && Number.isFinite(elapsed) && elapsed >= 0 && (
          <span className="mr-2 inline-block">
            Assessment completed in {(elapsed / 1000).toFixed(1)}s ·
          </span>
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
    <section
      id="key-findings"
      aria-labelledby="key-findings-title"
      className="scroll-mt-6 min-w-0 rounded-2xl border border-red-500/20 bg-zinc-900 p-4 sm:p-5 [overflow-wrap:anywhere]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="key-findings-title" className="text-lg font-semibold">
          Key Findings
        </h2>
        <span className="text-xs text-zinc-400">
          Deterministic evidence · Verified by DeployGuard
        </span>
      </div>
      <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
        {failed.map((check) => (
          <article key={check.id} className="min-w-0 [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{check.name}</h3>
              <StatusBadge check={check} />
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              {check.summary}
            </p>
            <FindingEvidence evidence={check.evidence ?? []} />
          </article>
        ))}
      </div>
      <p className="mt-4 text-xs text-zinc-400">
        Only verified failures appear here. Blocked and unconfigured checks are
        shown in Verification Checks.
      </p>
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
          <p className="font-mono text-xs text-zinc-400">{item.step}</p>

          <p className="mt-2 font-medium text-zinc-200">{item.title}</p>

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

export function AiAvailabilityNotice({ availability }: {
  availability?: ReadinessReport["aiAvailability"];
}) {
  if (!availability ||
      (availability.architecture !== "unavailable" && availability.remediation !== "unavailable")) return null;
  const unavailable = [
    availability.architecture === "unavailable" ? "architecture analysis" : null,
    availability.remediation === "unavailable" ? "remediation" : null,
  ].filter(Boolean).join(" and ");
  return <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
    AI guidance was unavailable for {unavailable}. The verified checks, readiness score, and deterministic remediation plan are complete.
  </p>;
}

export function AssessmentPipeline({
  loading,
  progressByStage,
  checks,
}: {
  loading: boolean;
  progressByStage: Map<string, AssessmentProgressEvent>;
  checks: CheckResult[];
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">Live verification</p>

          <h2 className="mt-1 text-xl font-semibold">Assessment Pipeline</h2>
        </div>

        {loading && <span className="text-sm text-zinc-500">Running</span>}
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        {ASSESSMENT_STAGES.filter(({ stage }) =>
          !checks.some(
            (check) =>
              check.category === stage &&
              check.status === "skipped" &&
              check.skipReason === "not_applicable",
          ),
        ).map(({ stage, label }) => {
          const progress = progressByStage.get(stage);
          const status = progress?.status ?? "pending";

          return (
            <div
              key={stage}
              className="flex gap-4 border-b border-zinc-800 p-5 last:border-b-0"
            >
              <div
                className={`w-6 shrink-0 text-center font-semibold ${getProgressTextClass(
                  status,
                )}`}
              >
                {getProgressSymbol(status)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">{label}</p>

                  {progress?.elapsedMs !== undefined && (
                    <span className="font-mono text-xs text-zinc-400">
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

export function ReadinessScoreCard({ readiness }: { readiness: PublicProductionReadinessReport["readiness"] }) {
  const { score, coverage, evaluatedWeight, applicableWeight } = readiness;
  const insufficientEvidence = evaluatedWeight < applicableWeight;
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-zinc-400">Readiness score for evaluated checks</p>

          <p className="mt-2 text-5xl font-semibold">
            {score}
            <span className="text-2xl text-zinc-500">/100</span>
          </p>
        </div>

        <span className="w-fit shrink-0 whitespace-nowrap rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
          Deterministic
        </span>
      </div>

      {insufficientEvidence && (
        <div role="status" className="mt-5 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-amber-100">
          <p className="text-base font-semibold">Insufficient evidence</p>
          <p className="mt-1 text-sm font-semibold">Production readiness not established</p>
          <p className="mt-2 text-sm leading-6">
            Assessment coverage is {coverage}%. A high score reflects only evaluated checks, not all applicable verification categories.
          </p>
        </div>
      )}

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getScoreBarClass(
            score,
          )}`}
          style={{ width: `${score}%` }}
        />
      </div>

      <p className="mt-4 text-sm font-medium leading-6 text-zinc-300">
        Based only on evaluated evidence. Blocked and unevaluated categories
        are not verified failures and do not receive readiness credit.
      </p>

      <p className="mt-2 text-sm leading-6 text-zinc-500">
        Calculated from verified build, type, lint, test, security, database,
        deployment and environment evidence — not from an AI opinion.
      </p>
    </div>
  );
}

function CoverageCard({ coverage }: { coverage: number }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-zinc-400">Assessment Coverage</p>

          <p className="mt-2 text-5xl font-semibold">
            {coverage}
            <span className="text-2xl text-zinc-500">%</span>
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
        Share of applicable readiness weight counted as evaluated by the
        scoring model. Blocked and unevaluated categories are excluded; a
        not configured category counts as evaluated but earns no readiness
        credit.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                      Repository Build Configuration                        */
/* -------------------------------------------------------------------------- */

type RepositoryConfigurationRequirement = {
  variable: string;
  phase: "build" | "runtime" | "test" | "unknown";
  reason: string;
};

function RepositoryConfiguration({
  requirements,
  values,
  loading,
  onChange,
  onRetry,
}: {
  requirements: RepositoryConfigurationRequirement[];
  values: Record<string, string>;
  loading: boolean;
  onChange: (variable: string, value: string) => void;
  onRetry: () => void;
}) {
  if (requirements.length === 0) {
    return null;
  }

  const complete = requirements.every((requirement) =>
    Boolean(values[requirement.variable]?.length),
  );

  return (
    <section className="mb-10 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
      <div className="max-w-3xl">
        <p className="text-sm font-medium text-amber-300">
          Repository Configuration Required
        </p>

        <h2 className="mt-2 text-xl font-semibold">
          Complete build verification
        </h2>

        <p className="mt-3 text-sm leading-6 text-zinc-400">
          DeployGuard discovered configuration that the repository requires
          during isolated verification. Values entered here are sent only as
          execution inputs for this assessment and are never included in the
          public readiness report.
        </p>
      </div>

      <div className="mt-6 space-y-4">
        {requirements.map((requirement) => (
          <div
            key={`${requirement.phase}-${requirement.variable}`}
            className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor={`repository-environment-${requirement.variable}`}
                className="font-mono text-sm font-medium text-zinc-200"
              >
                {requirement.variable}
              </label>

              <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                {requirement.phase}
              </span>
            </div>

            <p className="mt-2 text-xs leading-5 text-zinc-500">
              {requirement.reason}
            </p>

            <input
              id={`repository-environment-${requirement.variable}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={values[requirement.variable] ?? ""}
              onChange={(event) =>
                onChange(requirement.variable, event.target.value)
              }
              disabled={loading}
              placeholder={`Enter ${requirement.variable}`}
              className="mt-4 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 font-mono text-sm text-zinc-100 outline-none transition placeholder:text-zinc-700 focus:border-amber-500/60 disabled:opacity-60"
            />
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onRetry}
          disabled={loading || !complete}
          className="rounded-xl bg-amber-300 px-5 py-3 font-medium text-zinc-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Verification running..." : "Retry with Configuration"}
        </button>

        <p className="text-xs leading-5 text-zinc-500">
          Values remain masked in the interface and are not displayed in
          assessment results.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                         Verification / Check Evidence                      */
/* -------------------------------------------------------------------------- */

export function VerificationChecks({ checks, onCopyFinding, copyFeedback }: {
  checks: CheckResult[];
  onCopyFinding?: (index: number) => void;
  copyFeedback?: { key: string; message: string } | null;
}) {
  return (
    <section id="verification-checks" className="scroll-mt-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Verification Checks</h2>

        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Deterministic findings captured directly from repository analysis and
          isolated sandbox execution.
        </p>
      </div>

      <div className="grid min-w-0 items-start gap-4 md:grid-cols-2">
        {checks.map((check, checkIndex) => {
          const evidence = check.evidence ?? [];

          return (
            <article
              key={check.id}
              className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5 [overflow-wrap:anywhere]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{check.name}</p>

                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    {check.summary}
                  </p>
                </div>

                <StatusBadge check={check} />
              </div>

              <p className="mt-3 text-xs leading-5 text-zinc-400">
                {getCheckStateDescription(check)}
              </p>

              {onCopyFinding && (
                <div className="mt-3">
                  <button type="button" onClick={() => onCopyFinding(checkIndex)}
                    className="min-h-11 rounded-lg border border-zinc-600 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800">
                    Copy Finding
                  </button>
                  {copyFeedback?.key === `finding-${checkIndex}` && (
                    <p role="status" className="mt-2 text-sm text-zinc-300">{copyFeedback.message}</p>
                  )}
                </div>
              )}

              {evidence.length > 0 && (
                <details className="mt-5 border-t border-zinc-800 pt-2">
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium text-zinc-200 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300">
                    <span>Captured evidence</span>
                    <span className="font-mono text-xs text-zinc-400">{evidence.length}</span>
                  </summary>

                  <div className="space-y-3">
                    {evidence.map((item, index) => {
                      const location = formatEvidenceLocation(item);

                      return (
                        <div
                          key={`${check.id}-evidence-${index}`}
                          className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${getEvidenceKindClass(
                                item.kind,
                              )}`}
                            >
                              {formatEvidenceKind(item.kind)}
                            </span>

                            {item.code && (
                              <span className="rounded-full border border-zinc-700 px-2.5 py-1 font-mono text-xs text-zinc-400">
                                {item.code}
                              </span>
                            )}
                            {formatDependencyScope(item) && (
                              <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300">
                                {formatDependencyScope(item)}
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
                </details>
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
          <p className="text-sm text-zinc-500">Live external research</p>

          <h2 className="mt-2 text-xl font-semibold">External Evidence</h2>
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

              <span className="text-xs uppercase tracking-wide text-zinc-400">
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
              <p className="mt-1 text-sm text-zinc-500">{evidence.publisher}</p>
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
        External evidence informs Nemotron analysis but does not directly
        determine the readiness score.
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

      <h2 className="mt-3 text-xl font-semibold">AI Architecture Analysis</h2>

      <p className="mt-3 text-sm leading-6 text-zinc-400">
        Nemotron reasons over verified evidence. DeployGuard executes checks and
        calculates the deterministic readiness score.
      </p>
      <p className="mt-4 leading-7 text-zinc-300">{architecture.summary}</p>

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
    <section id="remediation-plan" className="scroll-mt-6">
      <h2 className="mb-4 text-xl font-semibold">Remediation Plan</h2>

      <p className="mb-4 text-sm text-zinc-400">
        Deterministic recommendations from check outcomes and repository
        evidence.
      </p>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-400">
          No remediation items were generated.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <article
              key={`${item.category}-${index}`}
              className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5 [overflow-wrap:anywhere]"
            >
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-medium">{item.title}</h3>

                <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs uppercase tracking-wide text-zinc-400">
                  {item.priority}
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-zinc-400">
                {item.recommendation}
              </p>
              {checks
                .filter(
                  (check) =>
                    check.category === item.category &&
                    check.status === "failed" &&
                    check.evidence?.length,
                )
                .map((check) => (
                  <div
                    key={check.id}
                    className="mt-4 min-w-0 border-t border-zinc-800 pt-3 [overflow-wrap:anywhere]"
                  >
                    <p className="text-xs font-medium text-zinc-400">
                      Verified evidence · {check.name}
                    </p>
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
}: {
  remediation: NonNullable<ReadinessReport["aiRemediation"]>;
  checks: CheckResult[];
}) {
  const checksById = new Map(checks.map((check) => [check.id, check]));

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
            Nemotron explains verified failures using structured evidence
            captured by DeployGuard. Every displayed evidence reference passed
            deterministic verification.
          </p>
        </div>

        <span className="shrink-0 whitespace-nowrap rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
          {remediation.actions.length} verified{" "}
          {remediation.actions.length === 1 ? "action" : "actions"}
        </span>
      </div>

      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
          Nemotron Summary
        </p>

        <p className="mt-2 text-sm leading-6 text-zinc-300">
          {remediation.summary}
        </p>
      </div>

      <div className="mt-5 space-y-4">
        {remediation.actions.map((action, actionIndex) => {
          const check = checksById.get(action.checkId);

          const referencedEvidence = check?.evidence
            ? action.evidenceIndexes
                .map((index) => ({
                  index,
                  evidence: check.evidence?.[index],
                }))
                .filter(
                  (
                    item,
                  ): item is {
                    index: number;
                    evidence: CheckEvidence;
                  } => item.evidence !== undefined,
                )
            : [];

          return (
            <article
              key={`${action.checkId}-${actionIndex}`}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">
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
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
                  Explanation
                </p>

                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {action.explanation}
                </p>
              </div>

              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
                  Recommendation
                </p>

                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  {action.recommendation}
                </p>
              </div>

              {referencedEvidence.length > 0 && (
                <div className="mt-5 border-t border-zinc-800 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
                      Verified Evidence References
                    </p>

                    <span className="text-xs font-medium text-emerald-400">
                      ✓ References verified
                    </span>
                  </div>

                  <div className="mt-3 space-y-3">
                    {referencedEvidence.map(({ index, evidence }) => {
                      const location = formatEvidenceLocation(evidence);

                      return (
                        <div
                          key={`${action.checkId}-${actionIndex}-evidence-${index}`}
                          className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-zinc-400">
                              Evidence #{index}
                            </span>

                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${getEvidenceKindClass(
                                evidence.kind,
                              )}`}
                            >
                              {formatEvidenceKind(evidence.kind)}
                            </span>

                            {evidence.code && (
                              <span className="rounded-full border border-zinc-700 px-2.5 py-1 font-mono text-xs text-zinc-400">
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
                    })}
                  </div>
                </div>
              )}

              {referencedEvidence.length === 0 && (
                <p className="mt-5 border-t border-zinc-800 pt-4 text-xs leading-5 text-zinc-400">
                  This guidance concerns a verification limitation without
                  structured diagnostic evidence.
                </p>
              )}
            </article>
          );
        })}
      </div>

      <p className="mt-5 border-t border-zinc-800 pt-4 text-xs leading-5 text-zinc-500">
        AI remediation is advisory. It does not modify the deterministic
        readiness score or claim that a suggested change has been executed.
      </p>
    </section>
  );
}

export function ControlledRemediation({
  candidates,
  onExecute,
  executing,
}: {
  candidates: ControlledRemediationCandidate[];
  onExecute: (candidate: ControlledRemediationCandidate) => Promise<void>;
  executing: boolean;
}) {
  if (candidates.length === 0) return null;

  const packageGroups = new Map<string, ControlledRemediationCandidate[]>();

  const otherCandidates: ControlledRemediationCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.strategy === "dependency_security" && candidate.packageName) {
      const group = packageGroups.get(candidate.packageName) ?? [];
      group.push(candidate);
      packageGroups.set(candidate.packageName, group);
    } else {
      otherCandidates.push(candidate);
    }
  }

  const groups = [...packageGroups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <section id="controlled-remediation" className="scroll-mt-6 min-w-0 rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 sm:p-5 [overflow-wrap:anywhere]">
      <h2 className="text-xl font-semibold text-violet-200">
        Controlled Remediation
      </h2>

      <p className="mt-2 text-sm text-zinc-400">
        DeployGuard can apply a deterministic fix in a disposable workspace,
        then independently verify it. Your GitHub repository is not modified.
      </p>

      {groups.length > 0 && (
        <>
          <p className="mt-4 text-sm text-zinc-400">
            {groups.length} affected{" "}
            {groups.length === 1 ? "package" : "packages"} ·{" "}
            {groups.reduce((total, [, items]) => total + items.length, 0)}{" "}
            security advisories
          </p>

          <div className="mt-4 space-y-3">
            {groups.map(([packageName, items]) => (
              <details
                key={packageName}
                className="group rounded-xl border border-violet-500/30 bg-zinc-950/60"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-4 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 marker:hidden [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="block break-all font-medium text-violet-200">
                      {packageName}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-400">
                      {items.length}{" "}
                      {items.length === 1 ? "advisory" : "advisories"}
                    </span>
                  </span>

                  <span
                    aria-hidden="true"
                    className="shrink-0 text-sm text-violet-300 transition-transform group-open:rotate-180"
                  >
                    ▼
                  </span>
                </summary>

                <div className="space-y-2 border-t border-violet-500/20 p-4">
                  <p className="mb-3 text-xs text-zinc-500">
                    Select an individual advisory to run its independently
                    verified remediation.
                  </p>

                  {items.map((candidate) => (
                    <div
                      key={controlledRemediationCandidateKey(candidate)}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
                    >
                      <span className="break-all text-sm text-zinc-300">
                        Advisory {candidate.advisoryId}
                      </span>

                      <button
                        type="button"
                        disabled={executing}
                        onClick={() => void onExecute(candidate)}
                        aria-label={`Remediate ${packageName} advisory ${candidate.advisoryId}`}
                        className="min-h-11 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {executing ? "Running..." : "Remediate"}
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </>
      )}

      {otherCandidates.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {otherCandidates.map((candidate) => (
            <button
              key={controlledRemediationCandidateKey(candidate)}
              type="button"
              disabled={executing}
              onClick={() => void onExecute(candidate)}
              className="min-h-11 min-w-0 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-2.5 text-sm font-medium text-violet-200 hover:bg-violet-500/20 disabled:opacity-50"
            >
              {executing
                ? "Running controlled remediation..."
                : `Remediate ${candidate.checkName}`}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Dashboard                                  */
/* -------------------------------------------------------------------------- */

function RemediationProof({ result }: { result: RemediationResult }) {
  const remediation = result.remediation;
  const proof = remediation.proof;

  const verifiedPatch = remediation.verifiedPatch;

  const proven = proof?.status === "proven";

  const readinessImpact = proof?.readinessImpact;

  const comparisons = proof?.comparisons ?? [];

  const regressionChecks = proof?.regressionChecks ?? [];

  const regressionPassed =
    regressionChecks.length > 0 &&
    regressionChecks.every((check) => check.status === "passed");

  const isLintRemediation = remediation.proposal.strategy === "lint_autofix";

  const targetImproved =
    comparisons.length > 0 &&
    comparisons.every((comparison) => comparison.improved);

  const stages = [
    {
      label: isLintRemediation
        ? "Lint failure detected"
        : "Vulnerability detected",
      complete: comparisons.length > 0,
    },
    {
      label: "Controlled fix applied",
      complete: remediation.execution.status === "applied",
    },
    {
      label: "Available regression checks passed",
      complete: regressionPassed,
    },
    {
      label: isLintRemediation ? "Lint re-verified" : "Security re-verified",
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
              {proven ? "Remediation Proven" : "Remediation Result"}
            </h2>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              {proof?.summary ?? remediation.execution.summary}
            </p>
          </div>

          <span
            className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide ${
              proven
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            {proof?.status ?? remediation.execution.status}
          </span>
        </div>

        {/* Proof lifecycle */}

        <div className="mt-8">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
            Verification Lifecycle
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {stages.map((stage, index) => (
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
                        : "border-zinc-700 text-zinc-400"
                    }`}
                  >
                    {stage.complete ? "✓" : index + 1}
                  </span>

                  <span className="text-xs text-zinc-500">
                    Step {index + 1}
                  </span>
                </div>

                <p
                  className={`mt-3 text-sm font-medium leading-5 ${
                    stage.complete ? "text-zinc-200" : "text-zinc-500"
                  }`}
                >
                  {stage.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Before / after evidence */}

        {comparisons.length > 0 && (
          <div className="mt-8">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
              Before / After Verification
            </p>

            <div className="mt-4 space-y-4">
              {comparisons.map((comparison) => (
                <article
                  key={comparison.checkId}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-medium text-zinc-200">
                      {comparison.before.name}
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
                        {comparison.before.status}
                      </p>

                      <p className="mt-2 text-xs leading-5 text-zinc-500">
                        {comparison.before.summary}
                      </p>
                    </div>

                    <div className="flex items-center justify-center px-2 text-xl text-zinc-400">
                      →
                    </div>

                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-emerald-400/70">
                        After
                      </p>

                      <p className="mt-2 text-lg font-semibold capitalize text-emerald-300">
                        {comparison.after.status}
                      </p>

                      <p className="mt-2 text-xs leading-5 text-zinc-500">
                        {comparison.after.summary}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {/* Regression safety */}

        {regressionChecks.length > 0 && (
          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
                Regression Safety
              </p>

              {regressionPassed && (
                <span className="text-xs font-medium text-emerald-400">
                  ✓ Available regression checks passed
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {regressionChecks.map((check) => (
                <div
                  key={check.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
                >
                  <p className="text-sm font-medium text-zinc-200">
                    {check.name}
                  </p>

                  <p
                    className={`mt-2 text-xs font-medium uppercase ${
                      check.status === "passed"
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }`}
                  >
                    {check.status === "passed" ? "✓ " : ""}
                    {check.status}
                  </p>

                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    {check.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deterministic readiness impact */}

        {/* Deterministic readiness impact */}

        {readinessImpact && (
          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
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
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                  Before
                </p>

                <p className="mt-2 text-2xl font-semibold text-zinc-200">
                  {readinessImpact.before.score}
                  <span className="text-sm text-zinc-400">/100</span>
                </p>

                <p className="mt-2 text-xs text-zinc-500">
                  Coverage {readinessImpact.before.coverage}%
                </p>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-emerald-400/70">
                  After
                </p>

                <p className="mt-2 text-2xl font-semibold text-emerald-300">
                  {readinessImpact.after.score}
                  <span className="text-sm text-zinc-400">/100</span>
                </p>

                <p className="mt-2 text-xs text-zinc-500">
                  Coverage {readinessImpact.after.coverage}%
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
                  {readinessImpact.delta > 0 ? "+" : ""}
                  {readinessImpact.delta}
                </p>

                <p className="mt-2 text-xs text-zinc-500">
                  Deterministic delta
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Recalculated deterministically from verified post-remediation
              checks. AI does not modify this score.
            </p>
          </div>
        )}
      </div>

      {/* Verified changes */}

      {verifiedPatch && verifiedPatch.fileCount > 0 && (
        <div className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
                Verified Changes
              </p>

              <p className="mt-2 text-sm leading-6 text-zinc-400">
                DeployGuard captured these workspace changes only after
                deterministic verification proved the remediation.
              </p>
            </div>

            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
              ✓ Proven patch
            </span>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/60">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
              <p className="text-sm font-medium text-zinc-300">
                {verifiedPatch.fileCount}{" "}
                {verifiedPatch.fileCount === 1 ? "file" : "files"} changed
              </p>

              <p className="text-xs text-zinc-400">Source contents protected</p>
            </div>

            <div className="divide-y divide-zinc-800">
              {verifiedPatch.files.map((file) => (
                <div
                  key={file.path}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <p className="break-all font-mono text-sm text-zinc-300">
                    {file.path}
                  </p>

                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${
                      file.changeType === "added"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : file.changeType === "deleted"
                          ? "border-red-500/30 bg-red-500/10 text-red-300"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    {file.changeType}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-3 text-xs leading-5 text-zinc-400">
            Full before/after source content remains inside the trusted
            DeployGuard execution boundary and is not returned by the public
            remediation API.
          </p>
        </div>
      )}

      {/* Trust boundary */}

      <div className="border-t border-zinc-800 bg-zinc-950/40 px-6 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-emerald-400">✓</span>

          <div>
            <p className="text-xs font-medium text-zinc-300">
              Source repository protected
            </p>

            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Remediation was executed inside a disposable DeployGuard
              workspace. The source GitHub repository was not modified.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ReadinessDashboard({
  developer,
}: {
  developer: { login: string } | null;
}) {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryAuthorizationRequired, setRepositoryAuthorizationRequired] =
    useState(false);
  const [authorizationReturnStatus, setAuthorizationReturnStatus] = useState<string | null>(null);
  const authorizationReturnStarted = useRef(false);


  const [remoteScan, setRemoteScan] = useState<RemoteScanResult | null>(null);

  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNetworkFailure, setScanNetworkFailure] = useState(false);
  const [assessmentNetworkFailure, setAssessmentNetworkFailure] = useState(false);
  const [assessmentMayStillRun, setAssessmentMayStillRun] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);

  const [showAllResearch, setShowAllResearch] = useState(false);

  const [assessment, setAssessment] = useState<AssessmentResult | null>(null);

  const [remediationLoading, setRemediationLoading] = useState(false);

  const [remediationError, setRemediationError] = useState<string | null>(null);

  const [remediationResult, setRemediationResult] =
    useState<RemediationResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const signInRequired = !developer || sessionExpired;

  const [progressEvents, setProgressEvents] = useState<
    AssessmentProgressEvent[]
  >([]);

  /* Execution inputs stay in component memory and are cleared on repository changes. */
  const [repositoryEnvironment, setRepositoryEnvironment] = useState<Record<string, string>>({});

  const identityRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const assessmentControllerRef = useRef<AbortController | null>(null);
  const scanControllerRef = useRef<AbortController | null>(null);
  const resumeControllerRef = useRef<AbortController | null>(null);
  const [assessedIdentity, setAssessedIdentity] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{ key: string; message: string } | null>(null);

  const invalidateRequests = useCallback(() => {
    generationRef.current += 1;
    // Client abort only stops listening; the server may continue its assessment.
    assessmentControllerRef.current?.abort();
    scanControllerRef.current?.abort();
    resumeControllerRef.current?.abort();
    assessmentControllerRef.current = null;
    scanControllerRef.current = null;
    resumeControllerRef.current = null;
    return generationRef.current;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Strict Mode immediately remounts effects; only abort after a real unmount.
      queueMicrotask(() => { if (!mountedRef.current) invalidateRequests(); });
    };
  }, [invalidateRequests]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine !== false);
    window.addEventListener?.("online", updateOnline);
    window.addEventListener?.("offline", updateOnline);
    return () => {
      window.removeEventListener?.("online", updateOnline);
      window.removeEventListener?.("offline", updateOnline);
    };
  }, []);

  const changeRepositoryUrl = useCallback((value: string) => {
    const identity = repositoryIdentity(value);
    setRepositoryUrl(value);
    if (!shouldInvalidateRepository(identityRef.current, value)) return;
    identityRef.current = identity;
    invalidateRequests();
    setAssessedIdentity(null);
    setAssessment(null);
    setRemoteScan(null);
    setProgressEvents([]);
    setRepositoryEnvironment({});
    setRepositoryAuthorizationRequired(false);
    setAuthorizationReturnStatus(null);
    setShowAllResearch(false);
    setRemediationResult(null);
    setRemediationError(null);
    setRemediationLoading(false);
    setScanError(null);
    setScanNetworkFailure(false);
    setAssessmentNetworkFailure(false);
    setAssessmentMayStillRun(false);
    setError(null);
    setCopyFeedback(null);
    setLoading(false);
    setScanLoading(false);
  }, [invalidateRequests]);

  const currentAssessment = assessment && assessedIdentity &&
    assessedIdentity === repositoryIdentity(repositoryUrl) &&
    assessedIdentity === repositoryIdentity(assessment.repository.url) &&
    assessedIdentity === assessment.repository.fullName.toLowerCase()
    ? assessment : null;
  const currentScan = remoteScan &&
    repositoryIdentity(remoteScan.repository.url) === repositoryIdentity(repositoryUrl) &&
    remoteScan.repository.fullName.toLowerCase() === repositoryIdentity(repositoryUrl)
    ? remoteScan : null;
  const currentRemediationResult = currentAssessment && remediationResult &&
    repositoryIdentity(remediationResult.repository.url) === assessedIdentity &&
    remediationResult.repository.fullName.toLowerCase() === assessedIdentity &&
    remediationResult.sourceCommitSha === currentAssessment.sourceCommitSha
    ? remediationResult : null;
  const report = currentAssessment?.report ?? null;
  const currentArtifact = currentAssessment ? currentAssessmentArtifact(
    { repositoryIdentity: currentAssessment.repository.fullName, sourceCommitSha: currentAssessment.sourceCommitSha },
    currentRemediationResult ? {
      repositoryIdentity: currentRemediationResult.repository.fullName,
      sourceCommitSha: currentRemediationResult.sourceCommitSha,
      proofStatus: currentRemediationResult.remediation.proof?.status,
      artifactId: currentRemediationResult.remediation.verifiedArtifactReference?.artifactId,
      deliveryEligible: currentRemediationResult.remediation.verifiedArtifactReference?.deliveryEligible,
    } : null,
  ) : null;
  const research = currentAssessment?.research ?? null;
  const hasAiInsights = Boolean((research?.evidence.length ?? 0) > 0 ||
    report?.architecture || (report?.aiRemediation?.actions.length ?? 0) > 0);

  async function copyAssessmentText(key: string, value: string | null) {
    if (!currentAssessment ||
        repositoryIdentity(currentAssessment.repository.url) !== identityRef.current ||
        !mountedRef.current) return;
    if (!value) {
      setCopyFeedback({ key, message: "Shareable context is unavailable for this assessment." });
      return;
    }
    const generation = generationRef.current;
    const copied = await writeShareText(value);
    if (!mountedRef.current || generation !== generationRef.current ||
        repositoryIdentity(currentAssessment.repository.url) !== identityRef.current) return;
    setCopyFeedback({ key, message: copied ? "Copied to clipboard." :
      "Could not access the clipboard. Check browser permissions and try again." });
  }

  const configurationRequirements = useMemo(() => {
    const requirements =
      report?.checks.flatMap(
        (check) => check.configurationRequirements ?? [],
      ) ?? [];

    const unique = new Map<string, RepositoryConfigurationRequirement>();

    for (const requirement of requirements) {
      const key = `${requirement.phase}:${requirement.variable}`;

      if (!unique.has(key)) {
        unique.set(key, requirement);
      }
    }

    return Array.from(unique.values()).sort((left, right) =>
      left.variable.localeCompare(right.variable),
    );
  }, [report]);

  const progressByStage = useMemo(() => {
    const map = new Map<string, AssessmentProgressEvent>();

    for (const event of progressEvents) {
      map.set(event.stage, event);
    }

    return map;
  }, [progressEvents]);

  async function scanRepository() {
    const requestedUrl = repositoryUrl.trim();
    const requestedIdentity = repositoryIdentity(requestedUrl);
    if (!requestedIdentity) { setScanError("A valid GitHub repository URL is required."); return; }
    if (!mountedRef.current || requestedIdentity !== identityRef.current) return;
    const generation = invalidateRequests();
    const controller = new AbortController();
    scanControllerRef.current = controller;
    const current = () => mountedRef.current && isCurrentRequest(generation, generationRef.current,
      requestedIdentity, identityRef.current, controller.signal.aborted);
    setScanLoading(true);
    setScanError(null);
    setScanNetworkFailure(false);
    setRemoteScan(null);

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setScanError("You are offline. Reconnect and retry the static scan.");
      setScanNetworkFailure(true);
      setScanLoading(false);
      scanControllerRef.current = null;
      return;
    }

    let httpError = false;
    try {
      const response = await fetch("/api/repositories/scan", {
        signal: controller.signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repositoryUrl: requestedUrl,
        }),
      });

      const data = await response.json();
      if (!current()) return;

      if (!response.ok || !data.ok) {
        httpError = true;
        throw new Error(data.error ?? "Repository scan failed.");
      }

      setRemoteScan({
        repository: data.repository,
        scan: data.scan,
      });
    } catch (scanError) {
      if (!current()) return;
      const networkFailure = !httpError && (scanError instanceof TypeError ||
        (typeof navigator !== "undefined" && navigator.onLine === false));
      setScanNetworkFailure(networkFailure);
      setScanError(
        networkFailure
          ? "The static scan could not connect. Check your connection and retry."
          : scanError instanceof Error
          ? scanError.message
          : "Unknown repository scan error.",
      );
    } finally {
      if (current()) setScanLoading(false);
      if (scanControllerRef.current === controller) scanControllerRef.current = null;
    }
  }

  const runAssessment = useCallback(async (repositoryOverride?: string) => {
    const requestedUrl = (repositoryOverride ?? repositoryUrl).trim();
    const requestedIdentity = repositoryIdentity(requestedUrl);
    if (!requestedIdentity) { setError("A valid GitHub repository URL is required."); return; }
    if (!mountedRef.current || requestedIdentity !== identityRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("You are offline. Reconnect before starting an assessment.");
      setAssessmentNetworkFailure(true);
      setAssessmentMayStillRun(false);
      return;
    }
    const generation = invalidateRequests();
    const controller = new AbortController();
    assessmentControllerRef.current = controller;
    const current = () => mountedRef.current && isCurrentRequest(generation, generationRef.current,
      requestedIdentity, identityRef.current, controller.signal.aborted);
    let receivedResult = false;
    let requestStarted = false;
    let serverError = false;
    let interruptedStream = false;
    let protocolError = false;
    setLoading(true);
    setError(null);
    setAssessmentNetworkFailure(false);
    setAssessmentMayStillRun(false);
    setRepositoryAuthorizationRequired(false);
    setAssessment(null);
    setAssessedIdentity(null);
    setProgressEvents([]);
    setShowAllResearch(false);
    setRemediationResult(null);
    setRemediationError(null);
    setRemediationLoading(false);
    setCopyFeedback(null);

    try {
      requestStarted = true;
      const response = await fetch("/api/assessment", {
        signal: controller.signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repositoryUrl: requestedUrl,

          ...(Object.keys(repositoryEnvironment).length > 0
            ? {
                environment: repositoryEnvironment,
              }
            : {}),
        }),
      });
      if (!current()) return;

      if (!response.ok) {
        serverError = true;
        const data = (await response.json()) as {
          code?: string;
          error?: string;
        };
        if (!current()) return;

        if (response.status === 401) {
          setSessionExpired(true);
          return;
        }

        if (
          response.status === 403 &&
          data.code === "REPOSITORY_AUTHORIZATION_REQUIRED"
        ) {
          setRepositoryAuthorizationRequired(true);
          return;
        }

        throw new Error(data.error ?? "Assessment failed.");
      }

      if (!response.body) {
        protocolError = true;
        throw new Error("Assessment stream is unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      let assessmentError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (!current()) { await reader.cancel().catch(() => {}); return; }

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
            const progress = parsed.data as AssessmentProgressEvent;

            setProgressEvents((current) => [...current, progress]);

            continue;
          }

          if (parsed.event === "result") {
            const payload = parsed.data as {
              ok: boolean;
              assessment: AssessmentResult;
            };

            if (payload.ok && payload.assessment) {
              if (repositoryIdentity(payload.assessment.repository.url) !== requestedIdentity) {
                protocolError = true;
                throw new Error("Assessment result did not match the requested repository.");
              }
              receivedResult = true;
              setAssessment(payload.assessment);
              setAssessedIdentity(requestedIdentity);
            }

            continue;
          }

          if (parsed.event === "assessment-error") {
            const payload = parsed.data as {
              ok: boolean;
              error?: string;
            };

            assessmentError = payload.error ?? "Assessment failed.";
          }
        }
      }

      if (assessmentError) {
        serverError = true;
        throw new Error(assessmentError);
      }
      if (!receivedResult) {
        interruptedStream = true;
        throw new Error("Assessment connection ended before a final report was received.");
      }
    } catch (assessmentError) {
      if (!current()) return;
      if (receivedResult && !serverError && !protocolError) return;
      const networkFailure = !serverError && !protocolError && (assessmentError instanceof TypeError ||
        (typeof navigator !== "undefined" && navigator.onLine === false) ||
        interruptedStream);
      setAssessmentNetworkFailure(networkFailure);
      setAssessmentMayStillRun(networkFailure && requestStarted && !receivedResult);
      if (!receivedResult) {
        setProgressEvents((current) => current.map((event) => event.status === "running"
          ? { ...event, status: "error", message: networkFailure
            ? "Assessment connection ended before a final report was received."
            : assessmentError instanceof Error ? assessmentError.message : "Assessment failed." }
          : event));
      }
      setError(
        networkFailure
          ? "The assessment connection was interrupted. Check your connection. The previous assessment may still be running on the server. Starting another may run it twice."
          : assessmentError instanceof Error
          ? assessmentError.message
          : "Unknown assessment error.",
      );
    } finally {
      if (current()) {
        setLoading(false);
        setAuthorizationReturnStatus(null);
      }
      if (assessmentControllerRef.current === controller) assessmentControllerRef.current = null;
    }
  }, [repositoryUrl, repositoryEnvironment, invalidateRequests]);

  useEffect(() => {
    if (authorizationReturnStarted.current) return;
    authorizationReturnStarted.current = true;

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get("github_authorization_return") === "1") {
      currentUrl.searchParams.delete("github_authorization_return");
      window.history.replaceState(window.history.state, "", currentUrl);
      const resume = async () => {
        const generation = invalidateRequests();
        const controller = new AbortController();
        resumeControllerRef.current = controller;
        const current = () => mountedRef.current && generationRef.current === generation && !controller.signal.aborted;
        setAuthorizationReturnStatus("Checking repository access…");
        try {
          const response = await fetch("/api/github/install/resume", { method: "POST", cache: "no-store", signal: controller.signal });
          const result = await response.json() as {
            ok: boolean; outcome?: "success" | "incomplete" | "unavailable"; repositoryUrl?: string;
          };
          if (!current()) return;
          if (!response.ok || !result.ok || !result.repositoryUrl) {
            throw new Error("The installation return could not be verified. Please assess the repository again.");
          }
          sessionStorage.removeItem("deployguard:repository-url");
          changeRepositoryUrl(result.repositoryUrl);
          if (result.outcome === "success") {
            setAuthorizationReturnStatus("Repository access granted. Resuming assessment…");
            await runAssessment(result.repositoryUrl);
          } else if (result.outcome === "incomplete") {
            setAuthorizationReturnStatus(null);
            setError("DeployGuard still does not have access to this repository. Please select it in GitHub and try again.");
            setRepositoryAuthorizationRequired(true);
          } else {
            setAuthorizationReturnStatus(null);
            setError("Repository authorization could not be verified. Please try assessing the repository again.");
          }
        } catch (failure) {
          if (!current()) return;
          setAuthorizationReturnStatus(null);
          setError(failure instanceof Error ? failure.message : "The installation return could not be verified.");
        } finally {
          if (resumeControllerRef.current === controller) resumeControllerRef.current = null;
        }
      };
      void resume();
      return;
    }

    const savedUrl = sessionStorage.getItem("deployguard:repository-url");

    if (!savedUrl) return;

    sessionStorage.removeItem("deployguard:repository-url");
    const restore = window.setTimeout(() => changeRepositoryUrl(savedUrl), 0);

    return () => window.clearTimeout(restore);
  }, [runAssessment, changeRepositoryUrl, invalidateRequests]);

  async function runControlledRemediation(candidate: ControlledRemediationCandidate) {
    if (!currentAssessment || repositoryIdentity(repositoryUrl) !== identityRef.current || !mountedRef.current) return;
    const generation = generationRef.current;
    const identity = identityRef.current;
    const isCurrent = () => mountedRef.current && generationRef.current === generation && identityRef.current === identity;
    setRemediationLoading(true);
    setRemediationError(null);
    setRemediationResult(null);
    try {
      const check = report?.checks.find((item) => item.id === candidate.checkId);
      const current = getControlledRemediationCandidates(report?.checks ?? [])
        .find((item) => item.checkId === candidate.checkId &&
          item.evidenceIndexes[0] === candidate.evidenceIndexes[0] &&
          item.packageName === candidate.packageName && item.advisoryId === candidate.advisoryId);
      if (!check || !current) throw new Error("The controlled remediation candidate is no longer supported by verified evidence.");
      const proposal = candidate.strategy === "dependency_security" ? {
        id: `dependency-security-${candidate.packageName}-${candidate.advisoryId}`,
        title: `Remediate ${candidate.packageName} advisory ${candidate.advisoryId}`,
        description: "Apply controlled dependency security remediation and verify the result.",
        target: { checkId: candidate.checkId, category: candidate.category, evidenceIndexes: candidate.evidenceIndexes },
        strategy: "dependency_security" as const,
        risk: "breaking_change_allowed" as const,
        packageName: candidate.packageName,
        advisoryId: candidate.advisoryId,
      } : {
        id: "lint-autofix", title: "Apply controlled lint autofix",
        description: "Apply deterministic ESLint autofix and independently verify the result.",
        target: { checkId: candidate.checkId, category: candidate.category, evidenceIndexes: candidate.evidenceIndexes },
        strategy: "lint_autofix" as const, risk: "safe" as const,
      };
      const response = await fetch("/api/remediation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl: currentAssessment.repository.url, proposal }),
      });
      const data = await response.json();
      if (!isCurrent()) return;
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Controlled remediation failed.");
      setRemediationResult(data.remediation);
    } catch (failure) {
      if (!isCurrent()) return;
      setRemediationError(failure instanceof Error ? failure.message : "Unknown remediation error.");
    } finally {
      if (isCurrent()) setRemediationLoading(false);
    }
  }

  return (
    <main className="min-h-screen min-w-0 bg-zinc-950 text-zinc-100 [overflow-wrap:anywhere] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-2 [&_a:focus-visible]:outline-violet-300 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-violet-300 [&_summary:focus-visible]:outline-2 [&_summary:focus-visible]:outline-offset-2 [&_summary:focus-visible]:outline-violet-300">
      <div className="mx-auto max-w-6xl min-w-0 px-4 py-8 sm:px-6 sm:py-16">
        <header className="mb-12">
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
            DeployGuard AI
          </p>

          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            Production readiness, backed by evidence.
          </h1>

          <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-300 sm:text-lg sm:leading-8">
            DeployGuard executes real repository checks inside an isolated
            sandbox, verifies the evidence, then uses NVIDIA Nemotron to explain
            what is safe to ship and what still needs attention.
          </p>

          <ProcessOverview />

          <div className="mt-8 max-w-3xl min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
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
              onChange={(event) => changeRepositoryUrl(event.target.value)}
              placeholder="https://github.com/owner/repository"
              disabled={loading || scanLoading}
              className="mt-3 w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus-visible:border-violet-300 focus-visible:ring-2 focus-visible:ring-violet-300/60 disabled:opacity-60"
            />

            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={scanRepository}
                disabled={scanLoading || loading || !repositoryUrl.trim()}
                className="min-h-11 rounded-xl border border-zinc-700 px-5 py-3 font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {scanLoading ? "Scanning..." : "Static Scan"}
              </button>

              <button
                type="button"
                onClick={() => void runAssessment()}
                disabled={signInRequired || loading || scanLoading || !repositoryUrl.trim()}
                className="min-h-11 rounded-xl bg-white px-5 py-3 font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Assessment running..." : "Assess Repository"}
              </button>
            </div>

            {signInRequired && (
              <div className="mt-4 rounded-xl border border-sky-500/25 bg-sky-500/5 p-4">
                <p className="text-sm leading-6 text-zinc-300">
                  Sign in with GitHub to assess private repositories and deliver
                  verified remediation.
                </p>
                <a
                  href="/api/auth/github/start"
                  className="mt-3 inline-block rounded-xl border border-sky-500/40 bg-sky-500/10 px-5 py-3 text-sm font-medium text-sky-200 transition hover:bg-sky-500/20"
                >
                  Sign in with GitHub
                </a>
              </div>
            )}

            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Static Scan inspects repository evidence without executing code.
              Full Assessment runs isolated verification checks inside the
              DeployGuard sandbox.
            </p>

            {scanError && (
              <div className="mt-3" role="alert">
                <p className="text-sm text-red-400">{scanError}</p>
                {scanNetworkFailure && <button type="button" disabled={scanLoading || loading || !online}
                  onClick={() => void scanRepository()} className="mt-2 rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-100 disabled:opacity-50">Retry Static Scan</button>}
              </div>
            )}

            {error && <div className="mt-3" role="alert">
              <p className="text-sm text-red-400">{error}</p>
              {assessmentNetworkFailure && <button type="button" disabled={loading || scanLoading || signInRequired || !online}
                onClick={() => void runAssessment()} className="mt-2 rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-100 disabled:opacity-50">{assessmentMayStillRun ? "Start Another Assessment" : "Retry Assessment"}</button>}
            </div>}

            {authorizationReturnStatus && (
              <p className="mt-3 text-sm text-emerald-300" role="status">
                {authorizationReturnStatus}
              </p>
            )}

            {repositoryAuthorizationRequired && (
              <div className="mt-5 rounded-xl border border-amber-700/50 bg-amber-950/30 p-5">
                <h2 className="font-semibold text-amber-100">
                  Repository access required
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  DeployGuard does not currently have access to this repository.
                  Authorize the DeployGuard GitHub App and select this repository
                  to continue.
                </p>
                <a
                  href={`/api/github/install?repositoryUrl=${encodeURIComponent(repositoryUrl)}`}
                  onClick={() =>
                    sessionStorage.setItem(
                      "deployguard:repository-url",
                      repositoryUrl,
                    )
                  }
                  className="mt-4 inline-block rounded-xl bg-white px-5 py-3 font-medium text-zinc-950 transition hover:bg-zinc-200"
                >
                  Authorize Repository
                </a>
              </div>
            )}
          </div>
        </header>

        {(loading || progressEvents.length > 0) && (
          <AssessmentPipeline
            loading={loading}
            progressByStage={progressByStage}
            checks={report?.checks ?? []}
          />
        )}

        <RepositoryConfiguration
          requirements={configurationRequirements}
          values={repositoryEnvironment}
          loading={loading}
          onChange={(variable, value) =>
            setRepositoryEnvironment((current) => ({
              ...current,
              [variable]: value,
            }))
          }
          onRetry={() => void runAssessment()}
        />

        {currentScan && (
          <section className="mb-10 space-y-5">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="text-sm text-zinc-500">Repository</p>

              <h2 className="mt-2 break-words text-xl font-semibold">
                {currentScan.repository.fullName}
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
                {currentScan.scan.facts.map((fact) => (
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

                    <p className="mt-2 text-xs text-zinc-400">
                      Confidence {Math.round(fact.confidence * 100)}%
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div>
              <h2 className="mb-4 text-xl font-semibold">Evidence</h2>

              <div className="space-y-3">
                {currentScan.scan.facts.flatMap((fact) =>
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
                  )),
                )}
              </div>
            </div>
          </section>
        )}

        {report && (
          <div className="min-w-0 space-y-8 [overflow-wrap:anywhere]">
            <nav aria-label="Assessment report sections" className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 sm:p-4">
              <ul className="flex flex-wrap gap-2 text-sm font-medium">
                <li><a className="flex min-h-11 items-center rounded-lg border border-zinc-700 px-3 text-zinc-200 hover:bg-zinc-800" href="#report-overview">Overview</a></li>
                {report.readiness.breakdown.length > 0 && <li><a className="flex min-h-11 items-center rounded-lg border border-zinc-700 px-3 text-zinc-200 hover:bg-zinc-800" href="#readiness-breakdown">Score details</a></li>}
                <li><a className="flex min-h-11 items-center rounded-lg border border-zinc-700 px-3 text-zinc-200 hover:bg-zinc-800" href="#verification-checks">Checks</a></li>
                {hasAiInsights && <li><a className="flex min-h-11 items-center rounded-lg border border-zinc-700 px-3 text-zinc-200 hover:bg-zinc-800" href="#ai-insights">AI insights</a></li>}
                <li><a className="flex min-h-11 items-center rounded-lg border border-zinc-700 px-3 text-zinc-200 hover:bg-zinc-800" href="#remediation-plan">Remediation</a></li>
                {getControlledRemediationCandidates(report.checks).length > 0 && <li><a className="flex min-h-11 items-center rounded-lg border border-violet-500/40 px-3 text-violet-200 hover:bg-violet-500/10" href="#controlled-remediation">Controlled fixes</a></li>}
              </ul>
            </nav>

            <section id="report-overview" aria-label="Assessment overview" className="scroll-mt-6 grid min-w-0 gap-4 md:grid-cols-2">
              <ReadinessScoreCard readiness={report.readiness} />

              <CoverageCard coverage={report.readiness.coverage} />
            </section>

            <ReadinessBreakdown breakdown={report.readiness.breakdown} />

            <AssessmentSummary
              report={report}
              completion={progressByStage.get("report")}
            />

            <div className="flex flex-wrap items-center gap-3">
              <button type="button"
                onClick={() => void copyAssessmentText("context", currentAssessment && serializeAiContext(currentAssessment))}
                className="min-h-11 rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/20">
                Copy AI Context
              </button>
              {copyFeedback?.key === "context" && (
                <p role="status" className="text-sm text-zinc-300">{copyFeedback.message}</p>
              )}
            </div>

            <AiAvailabilityNotice availability={report.aiAvailability} />

            <KeyFindings checks={report.checks} />

            <section className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 sm:p-6">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                Evidence before AI opinion
              </p>

              <h2 className="mt-2 text-2xl font-semibold">
                What DeployGuard verified
              </h2>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                The readiness score above is produced from deterministic
                repository and runtime evidence. External research and NVIDIA
                Nemotron add context and explanation, but they do not invent the
                score.
              </p>
            </section>

            <VerificationChecks checks={report.checks}
              onCopyFinding={(index) => void copyAssessmentText(
                `finding-${index}`, currentAssessment && serializeFinding(currentAssessment, index))}
              copyFeedback={copyFeedback} />

            {hasAiInsights && (
              <section id="ai-insights" aria-label="AI insights" className="scroll-mt-6 min-w-0 space-y-4">
                <h2 className="text-xl font-semibold">AI insights</h2>
                {research && research.evidence.length > 0 && (
                  <ExternalEvidence
                    research={research}
                    showAll={showAllResearch}
                    onToggle={() => setShowAllResearch((current) => !current)}
                  />
                )}
                {report.architecture && <ArchitectureAnalysis architecture={report.architecture} />}
                {report.aiRemediation && report.aiRemediation.actions.length > 0 && (
                  <AiRemediationGuidance remediation={report.aiRemediation} checks={report.checks} />
                )}
              </section>
            )}

            <RemediationPlan
              items={report.remediation}
              checks={report.checks}
            />

            <ControlledRemediation
              candidates={getControlledRemediationCandidates(report.checks)}
              onExecute={runControlledRemediation}
              executing={remediationLoading}
            />

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

            {currentRemediationResult && (
              <RemediationProof result={currentRemediationResult} />
            )}

            {report && (
              <RemediationDelivery
                key={currentArtifact?.artifactId ?? `${currentAssessment?.repository.fullName}-${currentAssessment?.sourceCommitSha}-remediation-delivery`}
                developer={sessionExpired ? null : developer}
                repositoryIdentity={currentAssessment?.repository.fullName ?? ""}
                sourceCommitSha={currentAssessment?.sourceCommitSha}
                generated={Boolean(currentArtifact)}
                artifactId={currentArtifact?.artifactId}
                deliveryEligible={currentArtifact?.deliveryEligible === true}
              />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
