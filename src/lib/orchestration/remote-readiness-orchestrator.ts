import {
  runArchitectAgent,
  type ArchitectureAnalysis,
} from "@/lib/agents/architect-agent";
import { runDeploymentAgent } from "@/lib/agents/deployment-agent";
import { runEnvironmentAgent } from "@/lib/agents/environment-agent";
import {
  runRemediationAgent,
  type RemediationAnalysis,
} from "@/lib/agents/remediation-agent";
import { runAiWithDeadline } from "@/lib/ai/ai-deadline";
import { NEMOTRON_ANALYSIS_TIMEOUT_MS, NEMOTRON_REMEDIATION_TIMEOUT_MS } from "@/lib/ai/nebius";
import { verifyRemediationAnalysis } from "@/lib/agents/remediation-verifier";
import {
  runResearchAgent,
  type ResearchAgentResult,
} from "@/lib/agents/research-agent";
import { runSandboxBuildAgent } from "@/lib/agents/sandbox-build-agent";
import {
  createBuildEnvironmentRequirements,
} from "@/lib/sandbox/build-environment-requirements";
import { runSandboxLintAgent } from "@/lib/agents/sandbox-lint-agent";
import { runSandboxSecurityAgent } from "@/lib/agents/sandbox-security-agent";
import { runSandboxTestAgent } from "@/lib/agents/sandbox-test-agent";
import { runSandboxTypecheckAgent } from "@/lib/agents/sandbox-typecheck-agent";
import { verifyArchitectureAnalysis } from "@/lib/agents/verifier";

import type { CheckResult } from "@/lib/checks/types";

import type {
  AssessmentProgressCallback,
  AssessmentProgressStatus,
} from "@/lib/orchestration/assessment-progress";

import {
  classifyPreparationFailureStatus,
} from "@/lib/orchestration/preparation-failure-policy";

import { parseGitHubRepositoryUrl } from "@/lib/repository/github-repository";
import { ingestGitHubRepository } from "@/lib/repository/repository-ingestion";
import type {
  RepositoryReadTransportFactory,
} from "@/lib/repository/github-read-transport";

import { sanitizeReportForPublic } from "@/lib/reporting/public-report";
import { createProductionReadinessReport } from "@/lib/reporting/readiness-report";
import type { PublicProductionReadinessReport } from "@/lib/reporting/types";

import { scanRepository } from "@/lib/scanner/repository-scanner";
import { calculateReadinessScore } from "@/lib/scoring/readiness-score";

import { prepareSandboxWorkspace } from "@/lib/sandbox/workspace-preparation";

import {
  createPreparationPlan,
} from "@/lib/sandbox/preparation-planner";

export interface RemoteReadinessAssessmentOptions {
  /*
   * Explicit repository-scoped environment configuration.
   *
   * Values are execution inputs only. They must never be
   * copied into assessment reports, evidence, progress
   * events, or diagnostic logs.
   */
  environment?: Readonly<
    Record<string, string>
  >;

  /*
   * Optional repository-read authority.
   *
   * This is used only by repository ingestion and must
   * never be forwarded into the repository sandbox,
   * assessment evidence, reports, or progress events.
   */
  readTransportFactory?: RepositoryReadTransportFactory;

  onProgress?: AssessmentProgressCallback;
}

export interface RemoteReadinessAssessment {
  repository: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
  };

  research?: {
    queries: string[];
    evidence: {
      title: string;
      url: string;
      sourceType: string;
      authority: "primary" | "secondary" | "community";
      publisher?: string;
      publishedAt?: string;
    }[];
  };

  report: PublicProductionReadinessReport;

  verification?: {
    acceptedRisks: ArchitectureAnalysis["risks"];
    rejectedRisks: ArchitectureAnalysis["risks"];
  };
}

interface PerformanceTiming {
  stage: string;
  durationMs: number;
}

type ArchitectureOutcome =
  | {
      status: "passed";
      analysis: ArchitectureAnalysis;
    }
  | {
      status: "error";
      error: unknown;
    };

type RemediationOutcome =
  | {
      status: "passed";
      analysis: RemediationAnalysis;
    }
  | {
      status: "skipped";
    }
  | {
      status: "error";
      error: unknown;
    };

type PreparationResult = Awaited<
  ReturnType<typeof prepareSandboxWorkspace>
>;

type PreparationOutcome =
  | {
      status: "completed";
      preparation: PreparationResult;
    }
  | {
      status: "error";
      error: unknown;
    };

function createUnavailableCheck(
  id: string,
  category: CheckResult["category"],
  name: string,
  summary: string,
  status: Extract<
    CheckResult["status"],
    "blocked" | "error"
  > = "error"
): CheckResult {
  return {
    id,
    category,
    name,
    status,
    summary,
  };
}

function toProgressStatus(
  status: CheckResult["status"]
): AssessmentProgressStatus {
  return status;
}

function formatDuration(durationMs: number): string {
  return (durationMs / 1000).toFixed(2);
}

function logPerformanceSummary(
  timings: PerformanceTiming[],
  totalDurationMs: number
): void {
  console.log(
    "\n[DeployGuard Performance] Assessment timing summary"
  );

  for (const timing of timings) {
    console.log(
      `[DeployGuard Performance] ${timing.stage}: ${formatDuration(
        timing.durationMs
      )}s`
    );
  }

  console.log(
    `[DeployGuard Performance] Total Assessment: ${formatDuration(
      totalDurationMs
    )}s`
  );

  console.log(
    "[DeployGuard Performance] End timing summary\n"
  );
}

/*
 * External research may contain provider-specific
 * metadata and excerpts used internally by Nemotron.
 *
 * Only source metadata required by the dashboard
 * crosses the public response boundary.
 */
function sanitizeResearch(
  research: ResearchAgentResult | undefined
): RemoteReadinessAssessment["research"] {
  if (!research) {
    return undefined;
  }

  return {
    queries: research.queries,

    evidence: research.results.flatMap((result) =>
      result.evidence.map((item) => ({
        title: item.source.title,
        url: item.source.url,
        sourceType: item.source.sourceType,
        authority: item.source.authority,
        publisher: item.source.publisher,
        publishedAt: item.source.publishedAt,
      }))
    ),
  };
}

export async function runRemoteReadinessAssessment(
  repositoryUrl: string,
  options: RemoteReadinessAssessmentOptions = {}
): Promise<RemoteReadinessAssessment> {
  const {
    environment: repositoryEnvironment = {},
    onProgress,
  } = options;
  const assessmentStartedAt = Date.now();
  const timings: PerformanceTiming[] = [];

  const emitProgress = async (
    stage: string,
    label: string,
    status: AssessmentProgressStatus,
    message?: string
  ): Promise<void> => {
    await onProgress?.({
      stage,
      label,
      status,
      message,
      elapsedMs: Date.now() - assessmentStartedAt,
    });
  };

  const measureStage = async <T>(
    stage: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    const startedAt = Date.now();

    try {
      return await operation();
    } finally {
      const durationMs =
        Date.now() - startedAt;

      timings.push({
        stage,
        durationMs,
      });

      console.log(
        `[DeployGuard Performance] ${stage}: ${formatDuration(
          durationMs
        )}s`
      );
    }
  };

  try {
    const repository =
      parseGitHubRepositoryUrl(repositoryUrl);

    /*
     * Repository ingestion
     */

    await emitProgress(
      "repository",
      "Repository",
      "running",
      "Preparing repository..."
    );

    const ingested = await measureStage(
      "Repository Ingestion",
      () =>
        ingestGitHubRepository(
          repository,
          (message) =>
            emitProgress(
              "repository",
              "Repository",
              "running",
              message
            ),
          options.readTransportFactory
        )
    );

    await emitProgress(
      "repository",
      "Repository",
      "passed",
      "Repository prepared successfully."
    );

    try {
      /*
       * Repository scan
       */

      await emitProgress(
        "scan",
        "Repository Scan",
        "running",
        "Inspecting repository structure..."
      );

      const scan = await measureStage(
        "Repository Scan",
        async () =>
          scanRepository(
            ingested.repositoryPath
          )
      );

      await emitProgress(
        "scan",
        "Repository Scan",
        "passed",
        `Repository scan completed with ${scan.facts.length} detected facts.`
      );

      /*
       * Convert repository evidence into deterministic
       * sandbox preparation requirements.
       *
       * The scanner discovers infrastructure.
       * The planner decides what preparation is required.
       * The workspace executor performs those requirements.
       */
      const preparationPlan =
        createPreparationPlan(
          scan.facts
        );

      console.log(
        "[DeployGuard Preparation Plan]",
        JSON.stringify(
          preparationPlan,
          null,
          2
        )
      );

      /*
       * Research and sandbox preparation can begin
       * concurrently after repository facts exist.
       */

      await emitProgress(
        "research",
        "External Research",
        "running",
        "Researching current technology and security evidence..."
      );

      await emitProgress(
        "preparation",
        "Sandbox Preparation",
        "running",
        "Installing dependencies in the isolated workspace..."
      );

      /*
       * External research branch.
       *
       * Research is fail-open.
       */

      const researchPromise =
        (async (): Promise<
          ResearchAgentResult | undefined
        > => {
          try {
            const research =
              await measureStage(
                "External Research",
                () =>
                  runResearchAgent(scan)
              );

            const evidenceCount =
              research.results.reduce(
                (total, result) =>
                  total +
                  result.evidence.length,
                0
              );

            if (
              research.queries.length === 0
            ) {
              await emitProgress(
                "research",
                "External Research",
                "skipped",
                "No repository facts required external research."
              );
            } else {
              await emitProgress(
                "research",
                "External Research",
                "passed",
                `External research completed with ${evidenceCount} evidence items.`
              );
            }

            return research;
          } catch (error) {
            const diagnostic =
              error instanceof Error
                ? error.message
                : "Unknown research error.";

            console.error(
              "[DeployGuard Research Agent]",
              diagnostic
            );

            await emitProgress(
              "research",
              "External Research",
              "error",
              "External research was unavailable. Continuing with repository evidence only."
            );

            return undefined;
          }
        })();

      /*
       * Sandbox preparation branch.
       */

      const preparationPromise: Promise<PreparationOutcome> =
        measureStage(
          "Sandbox Preparation",
          () =>
            prepareSandboxWorkspace(
              ingested.repositoryPath,
              preparationPlan
            )
        )
          .then(
            async (
              preparation
            ): Promise<PreparationOutcome> => {
              await emitProgress(
                "preparation",
                "Sandbox Preparation",
                preparation.status ===
                  "passed"
                  ? "passed"
                  : "error",
                preparation.summary
              );

              return {
                status: "completed",
                preparation,
              };
            }
          )
          .catch(
            async (
              error: unknown
            ): Promise<PreparationOutcome> => {
              const diagnostic =
                error instanceof Error
                  ? error.message
                  : "Unknown sandbox preparation error.";

              console.error(
                "[DeployGuard Sandbox Preparation]",
                diagnostic
              );

              await emitProgress(
                "preparation",
                "Sandbox Preparation",
                "error",
                "Sandbox preparation could not be completed."
              );

              return {
                status: "error",
                error,
              };
            }
          );

      /*
       * Nemotron architecture analysis depends on
       * research but not on sandbox execution.
       */

      const architecturePromise: Promise<ArchitectureOutcome> =
        researchPromise.then(
          async (
            research
          ): Promise<ArchitectureOutcome> => {
            await emitProgress(
              "architect",
              "Nemotron Analysis",
              "running",
              "Analyzing verified repository evidence..."
            );

            try {
              const analysis =
                await measureStage(
                  "Nemotron Analysis",
                  () => runAiWithDeadline(
                    NEMOTRON_ANALYSIS_TIMEOUT_MS,
                    (signal) => runArchitectAgent(scan, research, signal),
                  )
                );

              return {
                status: "passed",
                analysis,
              };
            } catch (error) {
              return {
                status: "error",
                error,
              };
            }
          }
        );

      const checks: CheckResult[] = [];

      /*
       * Static deterministic checks.
       */

      const environment =
        await measureStage(
          "Environment Check",
          async () =>
            runEnvironmentAgent(scan)
        );

      checks.push(environment);

      const deployment =
        await measureStage(
          "Deployment Check",
          async () =>
            runDeploymentAgent(scan)
        );

      checks.push(deployment);

      /*
       * Resolve sandbox preparation.
       */

      const preparationOutcome =
        await preparationPromise;

      if (
        preparationOutcome.status ===
        "error"
      ) {
        const message =
          preparationOutcome.error instanceof
          Error
            ? preparationOutcome.error
                .message
            : "Sandbox preparation could not be completed.";

        throw new Error(
          `Sandbox preparation failed: ${message}`
        );
      }

      const preparation =
        preparationOutcome.preparation;

      /*
       * Repository-controlled deterministic checks.
       *
       * These remain sequential because they share
       * the disposable repository workspace.
       */

      if (
        preparation.status === "passed"
      ) {
        /*
         * TypeScript
         */

        await emitProgress(
          "types",
          "TypeScript",
          "running",
          "Running TypeScript validation..."
        );

        const typecheck =
          await measureStage(
            "TypeScript",
            () =>
              runSandboxTypecheckAgent(
                ingested.repositoryPath
              )
          );

        checks.push(typecheck);

        await emitProgress(
          "types",
          "TypeScript",
          toProgressStatus(
            typecheck.status
          ),
          typecheck.summary
        );

        /*
         * Lint
         */

        await emitProgress(
          "lint",
          "Lint",
          "running",
          "Running lint validation..."
        );

        const lint =
          await measureStage(
            "Lint",
            () =>
              runSandboxLintAgent(
                ingested.repositoryPath
              )
          );

        checks.push(lint);

        await emitProgress(
          "lint",
          "Lint",
          toProgressStatus(lint.status),
          lint.summary
        );

        /*
         * Tests
         */

        await emitProgress(
          "test",
          "Tests",
          "running",
          "Running automated tests..."
        );

        const tests =
          await measureStage(
            "Tests",
            () =>
              runSandboxTestAgent(
                ingested.repositoryPath
              )
          );

        checks.push(tests);

        await emitProgress(
          "test",
          "Tests",
          toProgressStatus(tests.status),
          tests.summary
        );

        /*
         * Production build
         */

        await emitProgress(
          "build",
          "Production Build",
          "running",
          "Running production build..."
        );

        const build =
          await measureStage(
            "Production Build",
            () =>
              runSandboxBuildAgent(
                ingested.repositoryPath,
                createBuildEnvironmentRequirements(
                  preparationPlan.requirements,
                  repositoryEnvironment
                ),
                scan.facts
              )
          );

        checks.push(build);

        await emitProgress(
          "build",
          "Production Build",
          toProgressStatus(build.status),
          build.summary
        );

        /*
         * Dependency security
         */

        await emitProgress(
          "security",
          "Dependency Security",
          "running",
          "Running dependency security audit..."
        );

        const security =
          await measureStage(
            "Dependency Security",
            () =>
              runSandboxSecurityAgent(
                ingested.repositoryPath
              )
          );

        checks.push(security);

        await emitProgress(
          "security",
          "Dependency Security",
          toProgressStatus(
            security.status
          ),
          security.summary
        );
      } else {
        /*
         * Dependency preparation failed in a
         * structured way.
         *
         * Downstream executable checks therefore
         * cannot be completed.
         */

        const preparationSummary =
          preparation.summary;

        /*
         * Infrastructure failures must not be attributed
         * to the repository.
         *
         * A registry/network outage or sandbox timeout
         * means DeployGuard could not complete verification,
         * so downstream executable checks are blocked rather
         * than repository errors.
         */
        const unavailableStatus =
          classifyPreparationFailureStatus(
            preparation.failureKind
          );

        const unavailableChecks: CheckResult[] =
          [
            createUnavailableCheck(
              "types",
              "types",
              "TypeScript",
              preparationSummary,
              unavailableStatus
            ),
            createUnavailableCheck(
              "lint",
              "lint",
              "Lint",
              preparationSummary,
              unavailableStatus
            ),
            createUnavailableCheck(
              "test",
              "test",
              "Tests",
              preparationSummary,
              unavailableStatus
            ),
            createUnavailableCheck(
              "build",
              "build",
              "Production Build",
              preparationSummary,
              unavailableStatus
            ),
            createUnavailableCheck(
              "security",
              "security",
              "Dependency Security",
              preparationSummary,
              unavailableStatus
            ),
          ];

        checks.push(
          ...unavailableChecks
        );

        for (
          const check of
          unavailableChecks
        ) {
          await emitProgress(
            check.category,
            check.name,
            "error",
            check.summary
          );
        }
      }

      /*
       * Deterministic readiness score.
       *
       * Neither architecture analysis nor remediation
       * participates in this calculation.
       */

      console.log(
        "[DeployGuard Check Results]",
        JSON.stringify(
          checks.map((check) => ({
            id: check.id,
            category: check.category,
            name: check.name,
            status: check.status,
            skipReason: check.skipReason ?? null,
            summary: check.summary,

            /*
             * Structured evidence is safe and useful for
             * production diagnostics. Raw stdout/stderr
             * intentionally remain server-side and are
             * not included in this summary.
             */
            evidence:
              check.evidence ?? [],
          })),
          null,
          2
        )
      );

      const readiness =
        calculateReadinessScore(checks);

      console.log(
        "[DeployGuard Readiness Score]",
        JSON.stringify(readiness, null, 2)
      );

      /*
       * AI remediation starts only after deterministic
       * checks have finished and structured evidence
       * has been collected.
       *
       * The branch is fail-open.
       */

      const actionableChecks =
        checks.filter(
          (check) =>
            check.status === "failed" ||
            check.status === "blocked" ||
            check.status === "error"
        );

      const remediationPromise: Promise<RemediationOutcome> =
        actionableChecks.length === 0
          ? (async (): Promise<RemediationOutcome> => {
              await emitProgress(
                "remediation",
                "Nemotron Remediation",
                "skipped",
                "No failed, blocked, or errored checks require AI remediation."
              );

              return {
                status: "skipped",
              };
            })()
          : (async (): Promise<RemediationOutcome> => {
              await emitProgress(
                "remediation",
                "Nemotron Remediation",
                "running",
                "Generating evidence-grounded remediation guidance..."
              );

              try {
                const analysis =
                  await measureStage(
                    "Nemotron Remediation",
                    () => runAiWithDeadline(
                      NEMOTRON_REMEDIATION_TIMEOUT_MS,
                      (signal) => runRemediationAgent(checks, signal),
                    )
                  );

                return {
                  status: "passed",
                  analysis,
                };
              } catch (error) {
                return {
                  status: "error",
                  error,
                };
              }
            })();

      /*
       * Resolve architecture analysis.
       *
       * Remediation is now running concurrently
       * while this branch is verified.
       */

      const research =
        await researchPromise;

      const architectureOutcome =
        await architecturePromise;

      let architecture:
        | ArchitectureAnalysis
        | undefined;

      let verification:
        | RemoteReadinessAssessment["verification"]
        | undefined;

      if (
        architectureOutcome.status ===
        "passed"
      ) {
        const verified =
          verifyArchitectureAnalysis(
            scan,
            architectureOutcome.analysis,
            research
          );

        architecture = {
          ...architectureOutcome.analysis,
          risks:
            verified.acceptedRisks,
        };

        verification = {
          acceptedRisks:
            verified.acceptedRisks,
          rejectedRisks:
            verified.rejectedRisks,
        };

        await emitProgress(
          "architect",
          "Nemotron Analysis",
          "passed",
          "AI architecture analysis completed and verified."
        );
      } else {
        console.error("[DeployGuard Architect Agent] AI guidance unavailable.");

        architecture = undefined;
        verification = undefined;

        await emitProgress(
          "architect",
          "Nemotron Analysis",
          "error",
          "AI architecture analysis was unavailable. Deterministic readiness results are still available."
        );
      }

      /*
       * Deterministic production readiness report.
       */

      await emitProgress(
        "report",
        "Readiness Report",
        "running",
        "Calculating readiness and generating the final report..."
      );

      const report =
        await measureStage(
          "Readiness Report",
          async () =>
            createProductionReadinessReport(
              scan,
              checks,
              readiness,
              architecture
            )
        );

      /*
       * Resolve and independently verify Nemotron
       * remediation.
       *
       * AI failure never prevents the deterministic
       * report from completing.
       */

      const remediationOutcome =
        await remediationPromise;

      if (
        remediationOutcome.status ===
        "passed"
      ) {
        const verifiedRemediation =
          verifyRemediationAnalysis(
            checks,
            remediationOutcome.analysis
          );

        if (
          verifiedRemediation
            .acceptedActions.length > 0
        ) {
          report.aiRemediation = {
            summary:
              verifiedRemediation.summary,
            actions:
              verifiedRemediation
                .acceptedActions,
          };
        }

        if (
          verifiedRemediation
            .rejectedActions.length > 0
        ) {
          console.warn(
            `[DeployGuard Remediation Verifier] Rejected ${verifiedRemediation.rejectedActions.length} unverified remediation action(s).`
          );
        }

        await emitProgress(
          "remediation",
          "Nemotron Remediation",
          "passed",
          `AI remediation completed with ${verifiedRemediation.acceptedActions.length} verified action(s).`
        );
      } else if (
        remediationOutcome.status ===
        "error"
      ) {
        console.error("[DeployGuard Remediation Agent] AI guidance unavailable.");

        await emitProgress(
          "remediation",
          "Nemotron Remediation",
          "error",
          "AI remediation was unavailable. Deterministic remediation remains available."
        );
      }

      report.aiAvailability = {
        architecture: architectureOutcome.status === "passed" ? "available" : "unavailable",
        remediation: remediationOutcome.status === "passed" ? "available" :
          remediationOutcome.status === "skipped" ? "not_needed" : "unavailable",
      };

      /*
       * Never expose the temporary host workspace
       * path in the public response.
       */

      report.repository.path =
        repository.fullName;

      await emitProgress(
        "report",
        "Readiness Report",
        "completed",
        `Assessment completed with readiness score ${readiness.score}/100.`
      );

      /*
       * Public response boundary.
       *
       * Raw stdout/stderr remain server-side.
       */

      const publicResearch =
        sanitizeResearch(research);

      const publicReport =
        sanitizeReportForPublic(
          report
        );

      return {
        repository: {
          owner: repository.owner,
          name: repository.name,
          fullName:
            repository.fullName,
          url: repository.url,
        },

        research: publicResearch,
        report: publicReport,
        verification,
      };
    } finally {
      /*
       * Agents always operate against the
       * disposable ingestion workspace.
       */

      ingested.cleanup();
    }
  } finally {
    const totalDurationMs =
      Date.now() -
      assessmentStartedAt;

    logPerformanceSummary(
      timings,
      totalDurationMs
    );
  }
}
