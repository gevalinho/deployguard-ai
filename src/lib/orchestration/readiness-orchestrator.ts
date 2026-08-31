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

import { createProductionReadinessReport } from "@/lib/reporting/readiness-report";
import { scanRepository } from "@/lib/scanner/repository-scanner";
import { calculateReadinessScore } from "@/lib/scoring/readiness-score";

async function getVerifiedArchitectureAnalysis(
  scan: ReturnType<typeof scanRepository>
): Promise<ArchitectureAnalysis | undefined> {
  try {
    const analysis = await runArchitectAgent(scan);

    const verification = verifyArchitectureAnalysis(
      scan,
      analysis
    );

    return {
      ...analysis,

      // Only risks backed by valid repository evidence
      // are allowed into the final report.
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
  const scan = scanRepository(repositoryPath);

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

  const readiness = calculateReadinessScore(checks);

  /*
   * AI enrichment happens only after the deterministic
   * readiness assessment has completed.
   *
   * A Nebius/Nemotron failure must never prevent
   * DeployGuard from producing a readiness report.
   */
  const architecture =
    await getVerifiedArchitectureAnalysis(scan);

  return createProductionReadinessReport(
    scan,
    checks,
    readiness,
    architecture
  );
}