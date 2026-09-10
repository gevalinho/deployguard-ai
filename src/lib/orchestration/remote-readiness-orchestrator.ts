import type { ArchitectureAnalysis } from "@/lib/agents/architect-agent";
import { runArchitectAgent } from "@/lib/agents/architect-agent";
import { runDeploymentAgent } from "@/lib/agents/deployment-agent";
import { runEnvironmentAgent } from "@/lib/agents/environment-agent";
import {
  runResearchAgent,
  type ResearchAgentResult,
} from "@/lib/agents/research-agent";
import { runSandboxBuildAgent } from "@/lib/agents/sandbox-build-agent";
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
  parseGitHubRepositoryUrl,
} from "@/lib/repository/github-repository";

import {
  ingestGitHubRepository,
} from "@/lib/repository/repository-ingestion";

import {
  createProductionReadinessReport,
} from "@/lib/reporting/readiness-report";

import type {
  ProductionReadinessReport,
} from "@/lib/reporting/types";

import {
  scanRepository,
} from "@/lib/scanner/repository-scanner";

import {
  calculateReadinessScore,
} from "@/lib/scoring/readiness-score";

import {
  prepareSandboxWorkspace,
} from "@/lib/sandbox/workspace-preparation";

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

      authority:
        | "primary"
        | "secondary"
        | "community";

      publisher?: string;
      publishedAt?: string;
    }[];
  };

  report: ProductionReadinessReport;

  verification?: {
    acceptedRisks:
      ArchitectureAnalysis["risks"];

    rejectedRisks:
      ArchitectureAnalysis["risks"];
  };
}

interface PerformanceTiming {
  stage: string;
  durationMs: number;
}

function createUnavailableCheck(
  id: string,
  category: CheckResult["category"],
  name: string,
  summary: string
): CheckResult {
  return {
    id,
    category,
    name,
    status: "error",
    summary,
  };
}

function toProgressStatus(
  status: CheckResult["status"]
): AssessmentProgressStatus {
  return status;
}

function formatDuration(
  durationMs: number
): string {
  return (
    durationMs / 1000
  ).toFixed(2);
}

function logPerformanceSummary(
  timings: PerformanceTiming[],
  totalDurationMs: number
): void {
  console.log(
    "\n[DeployGuard Performance] Assessment timing summary"
  );

  for (
    const timing of timings
  ) {
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

export async function runRemoteReadinessAssessment(
  repositoryUrl: string,
  onProgress?: AssessmentProgressCallback
): Promise<RemoteReadinessAssessment> {
  const assessmentStartedAt =
    Date.now();

  const timings:
    PerformanceTiming[] = [];

  const emitProgress = async (
    stage: string,
    label: string,
    status: AssessmentProgressStatus,
    message?: string
  ) => {
    await onProgress?.({
      stage,
      label,
      status,
      message,
      elapsedMs:
        Date.now() -
        assessmentStartedAt,
    });
  };

  const measureStage =
    async <T>(
      stage: string,
      operation: () => Promise<T>
    ): Promise<T> => {
      const startedAt =
        Date.now();

      try {
        return await operation();
      } finally {
        const durationMs =
          Date.now() -
          startedAt;

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
      parseGitHubRepositoryUrl(
        repositoryUrl
      );

    /*
     * Repository ingestion
     */

    await emitProgress(
      "repository",
      "Repository",
      "running",
      "Preparing repository..."
    );

    const ingested =
      await measureStage(
        "Repository Ingestion",
        async () =>
          ingestGitHubRepository(
            repository,
            async (message) => {
              await emitProgress(
                "repository",
                "Repository",
                "running",
                message
              );
            }
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
       * Repository scanner
       */

      await emitProgress(
        "scan",
        "Repository Scan",
        "running",
        "Inspecting repository structure..."
      );

      const scan =
        await measureStage(
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
       * External research
       */

      let research:
        | ResearchAgentResult
        | undefined;

      await emitProgress(
        "research",
        "External Research",
        "running",
        "Researching current technology and security evidence..."
      );

      try {
        research =
          await measureStage(
            "External Research",
            async () =>
              runResearchAgent(
                scan
              )
          );

        const evidenceCount =
          research.results.reduce(
            (
              total,
              result
            ) =>
              total +
              result.evidence.length,
            0
          );

        if (
          research.queries.length ===
          0
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
      } catch (error) {
        research =
          undefined;

        const diagnostic =
          error instanceof Error
            ? error.message
            : "Unknown research error.";

        console.error(
          "[DeployGuard Research Agent]",
          diagnostic
        );

      //   await emitProgress(
      //     "research",
      //     "External Research",
      //     "error",
      //     "External research was unavailable. Continuing with repository evidence only."
      //   );
      // }

      // const checks:
      //   CheckResult[] = [];


                await emitProgress(
          "research",
          "External Research",
          "error",
          "External research was unavailable. Continuing with repository evidence only."
        );
      }

      /*
       * Start Nemotron as soon as repository
       * evidence and external research are ready.
       *
       * This runs concurrently with the
       * deterministic sandbox pipeline.
       *
       * The promise handles its own failure so
       * a rejected AI request cannot become an
       * unhandled rejection while sandbox checks
       * are still running.
       */

      await emitProgress(
        "architect",
        "Nemotron Analysis",
        "running",
        "Analyzing verified repository evidence..."
      );

      const architecturePromise =
        measureStage(
          "Nemotron Analysis",
          async () =>
            runArchitectAgent(
              scan,
              research
            )
        )
          .then((analysis) => ({
            analysis,
            error: undefined,
          }))
          .catch((error: unknown) => ({
            analysis: undefined,
            error,
          }));

      const checks:
        CheckResult[] = [];




      /*
       * Static checks
       *
       * These checks inspect scanner facts
       * and do not execute repository code.
       */

      const environment =
        await measureStage(
          "Environment Check",
          async () =>
            runEnvironmentAgent(
              scan
            )
        );

      checks.push(
        environment
      );

      const deployment =
        await measureStage(
          "Deployment Check",
          async () =>
            runDeploymentAgent(
              scan
            )
        );

      checks.push(
        deployment
      );

      /*
       * Sandbox dependency preparation
       */

      await emitProgress(
        "preparation",
        "Sandbox Preparation",
        "running",
        "Installing dependencies in the isolated workspace..."
      );

      const preparation =
        await measureStage(
          "Sandbox Preparation",
          async () =>
            prepareSandboxWorkspace(
              ingested.repositoryPath
            )
        );

      await emitProgress(
        "preparation",
        "Sandbox Preparation",
        preparation.status ===
          "passed"
          ? "passed"
          : "error",
        preparation.summary
      );

      /*
       * Repository-controlled checks
       */

      if (
        preparation.status ===
        "passed"
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
            async () =>
              runSandboxTypecheckAgent(
                ingested.repositoryPath
              )
          );

        checks.push(
          typecheck
        );

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
            async () =>
              runSandboxLintAgent(
                ingested.repositoryPath
              )
          );

        checks.push(
          lint
        );

        await emitProgress(
          "lint",
          "Lint",
          toProgressStatus(
            lint.status
          ),
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
            async () =>
              runSandboxTestAgent(
                ingested.repositoryPath
              )
          );

        checks.push(
          tests
        );

        await emitProgress(
          "test",
          "Tests",
          toProgressStatus(
            tests.status
          ),
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
            async () =>
              runSandboxBuildAgent(
                ingested.repositoryPath
              )
          );

        checks.push(
          build
        );

        await emitProgress(
          "build",
          "Production Build",
          toProgressStatus(
            build.status
          ),
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
            async () =>
              runSandboxSecurityAgent(
                ingested.repositoryPath
              )
          );

        checks.push(
          security
        );

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
         * Sandbox preparation failed.
         *
         * Repository-controlled checks
         * therefore cannot be executed.
         */

        const preparationSummary =
          preparation.summary;

        const unavailableChecks:
          CheckResult[] = [
          createUnavailableCheck(
            "types",
            "types",
            "TypeScript",
            preparationSummary
          ),

          createUnavailableCheck(
            "lint",
            "lint",
            "Lint",
            preparationSummary
          ),

          createUnavailableCheck(
            "test",
            "test",
            "Tests",
            preparationSummary
          ),

          createUnavailableCheck(
            "build",
            "build",
            "Production Build",
            preparationSummary
          ),

          createUnavailableCheck(
            "security",
            "security",
            "Dependency Security",
            preparationSummary
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
       * Deterministic readiness score
       */

      const readiness =
        calculateReadinessScore(
          checks
        );

      /*
       * Nemotron architecture analysis
       *
       * AI is optional.
       * Deterministic readiness reporting
       * must still work if the model fails.
       */

      // let architecture:
      //   | ArchitectureAnalysis
      //   | undefined;

      // let verification:
      //   | RemoteReadinessAssessment["verification"]
      //   | undefined;

      // await emitProgress(
      //   "architect",
      //   "Nemotron Analysis",
      //   "running",
      //   "Analyzing verified repository evidence..."
      // );

      // try {
      //   const analysis =
      //     await measureStage(
      //       "Nemotron Analysis",
      //       async () =>
      //         runArchitectAgent(
      //           scan,
      //           research
      //         )
      //     );

      //   const verified =
      //     verifyArchitectureAnalysis(
      //       scan,
      //       analysis,
      //       research
      //     );

      //   architecture = {
      //     ...analysis,

      //     risks:
      //       verified.acceptedRisks,
      //   };

      //   verification = {
      //     acceptedRisks:
      //       verified.acceptedRisks,

      //     rejectedRisks:
      //       verified.rejectedRisks,
      //   };

      //   await emitProgress(
      //     "architect",
      //     "Nemotron Analysis",
      //     "passed",
      //     "AI architecture analysis completed and verified."
      //   );
      // } catch (error) {
      //   architecture =
      //     undefined;

      //   verification =
      //     undefined;

      //   const diagnostic =
      //     error instanceof Error
      //       ? error.message
      //       : "Unknown Nemotron analysis error.";

      //   console.error(
      //     "[DeployGuard Architect Agent]",
      //     diagnostic
      //   );

      //   await emitProgress(
      //     "architect",
      //     "Nemotron Analysis",
      //     "error",
      //     "AI architecture analysis was unavailable. Deterministic readiness results are still available."
      //   );
      // }



            /*
       * Resolve the Nemotron analysis that
       * has been running concurrently with
       * the deterministic sandbox pipeline.
       *
       * Verification still happens only after
       * the AI result is available.
       */

      let architecture:
        | ArchitectureAnalysis
        | undefined;

      let verification:
        | RemoteReadinessAssessment["verification"]
        | undefined;

      const architectureResult =
        await architecturePromise;

      if (
        architectureResult.analysis
      ) {
        const verified =
          verifyArchitectureAnalysis(
            scan,
            architectureResult.analysis,
            research
          );

        architecture = {
          ...architectureResult.analysis,

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
        architecture =
          undefined;

        verification =
          undefined;

        const diagnostic =
          architectureResult.error
            instanceof Error
            ? architectureResult.error.message
            : "Unknown Nemotron analysis error.";

        console.error(
          "[DeployGuard Architect Agent]",
          diagnostic
        );

        await emitProgress(
          "architect",
          "Nemotron Analysis",
          "error",
          "AI architecture analysis was unavailable. Deterministic readiness results are still available."
        );
      }

      /*
       * Production readiness report
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
       * Never expose temporary host paths
       * in the public report.
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
       * Sanitize external research before
       * exposing it to the browser.
       */

      const publicResearch =
        research
          ? {
              queries:
                research.queries,

              evidence:
                research.results.flatMap(
                  (
                    result
                  ) =>
                    result.evidence.map(
                      (
                        item
                      ) => ({
                        title:
                          item.source
                            .title,

                        url:
                          item.source
                            .url,

                        sourceType:
                          item.source
                            .sourceType,

                        authority:
                          item.source
                            .authority,

                        publisher:
                          item.source
                            .publisher,

                        publishedAt:
                          item.source
                            .publishedAt,
                      })
                    )
                ),
            }
          : undefined;

      return {
        repository: {
          owner:
            repository.owner,

          name:
            repository.name,

          fullName:
            repository.fullName,

          url:
            repository.url,
        },

        research:
          publicResearch,

        report,
        verification,
      };
    } finally {
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