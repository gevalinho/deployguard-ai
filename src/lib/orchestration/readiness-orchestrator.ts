import type { ArchitectureAnalysis } from "@/lib/agents/architect-agent";

import { runArchitectAgent } from "@/lib/agents/architect-agent";
import { runBuildAgent } from "@/lib/agents/build-agent";
import { runDatabaseAgent } from "@/lib/agents/database-agent";
import { runDeploymentAgent } from "@/lib/agents/deployment-agent";
import { runEnvironmentAgent } from "@/lib/agents/environment-agent";
import { runLintAgent } from "@/lib/agents/lint-agent";
import { runSecurityAgent } from "@/lib/agents/security-agent";
import { runTestAgent } from "@/lib/agents/test-agent";
import { runTypecheckAgent } from "@/lib/agents/typecheck-agent";
import { verifyArchitectureAnalysis } from "@/lib/agents/verifier";
import { prepareAssessmentWorkspace } from "@/lib/agents/workspace-agent";

import { createProductionReadinessReport } from "@/lib/reporting/readiness-report";
import { scanRepository } from "@/lib/scanner/repository-scanner";
import { calculateReadinessScore } from "@/lib/scoring/readiness-score";
import { createAssessmentWorkspace } from "@/lib/workspace/assessment-workspace";

async function getVerifiedArchitectureAnalysis(
  scan: ReturnType<typeof scanRepository>
): Promise<ArchitectureAnalysis | undefined> {
  try {
    const analysis = await runArchitectAgent(scan);

    const verification =
      verifyArchitectureAnalysis(
        scan,
        analysis
      );

    return {
      ...analysis,
      risks: verification.acceptedRisks,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown Architect Agent error";

    console.warn(
      `Architect Agent unavailable: ${message}`
    );

    return undefined;
  }
}

export async function runReadinessAssessment(
  repositoryPath: string
) {
  const workspace =
    createAssessmentWorkspace(repositoryPath);

  try {
    const preparation =
      await prepareAssessmentWorkspace(
        workspace.workspacePath
      );

    if (preparation.status !== "passed") {
      throw new Error(
        preparation.summary
      );
    }

    const scan = scanRepository(
      workspace.workspacePath
    );

    const [
      buildResult,
      typeResult,
      lintResult,
      testResult,
      securityResult,
      environmentResult,
      databaseResult,
      deploymentResult,
    ] = await Promise.all([
      runBuildAgent(scan),
      runTypecheckAgent(scan),
      runLintAgent(scan),
      runTestAgent(scan),
      runSecurityAgent(scan),
      runEnvironmentAgent(scan),
      runDatabaseAgent(scan),
      runDeploymentAgent(scan),
    ]);

    const checks = [
      buildResult,
      typeResult,
      lintResult,
      testResult,
      securityResult,
      environmentResult,
      databaseResult,
      deploymentResult,
    ];

    const readiness =
      calculateReadinessScore(checks);

    const architecture =
      await getVerifiedArchitectureAnalysis(
        scan
      );

    const report =
      createProductionReadinessReport(
        scan,
        checks,
        readiness,
        architecture
      );

    /*
     * The checks ran inside the isolated workspace,
     * but the report should identify the repository
     * the user actually submitted.
     */
    report.repository.path =
      repositoryPath;

    return report;
  } finally {
    workspace.cleanup();
  }
}