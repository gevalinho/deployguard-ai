import type { ArchitectureAnalysis } from "@/lib/agents/architect-agent";
import { runArchitectAgent } from "@/lib/agents/architect-agent";
import { runDeploymentAgent } from "@/lib/agents/deployment-agent";
import { runEnvironmentAgent } from "@/lib/agents/environment-agent";
import { runSandboxBuildAgent } from "@/lib/agents/sandbox-build-agent";
import { runSandboxLintAgent } from "@/lib/agents/sandbox-lint-agent";
import { runSandboxSecurityAgent } from "@/lib/agents/sandbox-security-agent";
import { runSandboxTestAgent } from "@/lib/agents/sandbox-test-agent";
import { runSandboxTypecheckAgent } from "@/lib/agents/sandbox-typecheck-agent";
import { verifyArchitectureAnalysis } from "@/lib/agents/verifier";

import type { CheckResult } from "@/lib/checks/types";

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

import type {
  AssessmentProgressCallback,
  AssessmentProgressStatus,
} from "@/lib/orchestration/assessment-progress";


export interface RemoteReadinessAssessment {
  repository: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
  };

  report: ProductionReadinessReport;

  verification?: {
    acceptedRisks: ArchitectureAnalysis["risks"];
    rejectedRisks: ArchitectureAnalysis["risks"];
  };
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

export async function runRemoteReadinessAssessment(
  repositoryUrl: string,
  onProgress?: AssessmentProgressCallback
): Promise<RemoteReadinessAssessment> {


const assessmentStartedAt = Date.now();

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
      Date.now() - assessmentStartedAt,
  });
};

await emitProgress(
  "repository",
  "Repository",
  "running",
  "Cloning repository..."
);

  const repository =
    parseGitHubRepositoryUrl(
      repositoryUrl
    );

  const ingested =
    await ingestGitHubRepository(
      repository
    );

    await emitProgress(
  "repository",
  "Repository",
  "passed",
  "Repository cloned successfully."
    );

  try {


    await emitProgress(
  "scan",
  "Repository Scan",
  "running",
  "Inspecting repository structure..."
);

    const scan =
      await scanRepository(
        ingested.repositoryPath
      );

      await emitProgress(
  "scan",
  "Repository Scan",
  "passed",
  `Repository scan completed with ${scan.facts.length} detected facts.`
);

    const checks: CheckResult[] = [];

    /*
     * Static checks do not execute
     * repository code.
     */
    checks.push(
      await runEnvironmentAgent(scan)
    );

    checks.push(
      await runDeploymentAgent(scan)
    );

    /*
     * Dependency preparation is performed
     * exactly once for this assessment.
     *
     * Installation has controlled network
     * access and lifecycle scripts disabled.
     */

    await emitProgress(
  "preparation",
  "Sandbox Preparation",
  "running",
  "Installing dependencies in the isolated workspace..."
);


    const preparation =
      await prepareSandboxWorkspace(
        ingested.repositoryPath
      );

    await emitProgress(
    "preparation",
    "Sandbox Preparation",
     preparation.status === "passed"
     ? "passed"
      : "error",
    preparation.summary
      );

    // if (preparation.status === "passed") {
    //   /*
    //    * Execute repository-controlled checks
    //    * sequentially against the same disposable
    //    * workspace.
    //    *
    //    * These checks run without network access.
    //    */
    //   checks.push(
    //     await runSandboxTypecheckAgent(
    //       ingested.repositoryPath
    //     )
    //   );

    //   checks.push(
    //     await runSandboxLintAgent(
    //       ingested.repositoryPath
    //     )
    //   );

    //   checks.push(
    //     await runSandboxTestAgent(
    //       ingested.repositoryPath
    //     )
    //   );

    //   checks.push(
    //     await runSandboxBuildAgent(
    //       ingested.repositoryPath
    //     )
    //   );

    //   /*
    //    * npm audit is a controlled command
    //    * requiring registry access.
    //    */
    //   checks.push(
    //     await runSandboxSecurityAgent(
    //       ingested.repositoryPath
    //     )
    //   );
    // } else {
    //   const preparationSummary =
    //     preparation.summary;

    //   checks.push(
    //     createUnavailableCheck(
    //       "types",
    //       "types",
    //       "TypeScript",
    //       preparationSummary
    //     ),

    //     createUnavailableCheck(
    //       "lint",
    //       "lint",
    //       "Lint",
    //       preparationSummary
    //     ),

    //     createUnavailableCheck(
    //       "test",
    //       "test",
    //       "Tests",
    //       preparationSummary
    //     ),

    //     createUnavailableCheck(
    //       "build",
    //       "build",
    //       "Production Build",
    //       preparationSummary
    //     ),

    //     createUnavailableCheck(
    //       "security",
    //       "security",
    //       "Dependency Security",
    //       preparationSummary
    //     )
    //   );
    // }

    if (preparation.status === "passed") {
  // TypeScript
  await emitProgress(
    "types",
    "TypeScript",
    "running",
    "Running TypeScript validation..."
  );

  const typecheck =
    await runSandboxTypecheckAgent(
      ingested.repositoryPath
    );

  checks.push(typecheck);

  await emitProgress(
    "types",
    "TypeScript",
    toProgressStatus(typecheck.status),
    typecheck.summary
  );

  // Lint
  await emitProgress(
    "lint",
    "Lint",
    "running",
    "Running lint validation..."
  );

  const lint =
    await runSandboxLintAgent(
      ingested.repositoryPath
    );

  checks.push(lint);

  await emitProgress(
    "lint",
    "Lint",
    toProgressStatus(lint.status),
    lint.summary
  );

  // Tests
  await emitProgress(
    "test",
    "Tests",
    "running",
    "Running automated tests..."
  );

  const tests =
    await runSandboxTestAgent(
      ingested.repositoryPath
    );

  checks.push(tests);

  await emitProgress(
    "test",
    "Tests",
    toProgressStatus(tests.status),
    tests.summary
  );

  // Production Build
  await emitProgress(
    "build",
    "Production Build",
    "running",
    "Running production build..."
  );

  const build =
    await runSandboxBuildAgent(
      ingested.repositoryPath
    );

  checks.push(build);

  await emitProgress(
    "build",
    "Production Build",
    toProgressStatus(build.status),
    build.summary
  );

  // Dependency Security
  await emitProgress(
    "security",
    "Dependency Security",
    "running",
    "Running dependency security audit..."
  );

  const security =
    await runSandboxSecurityAgent(
      ingested.repositoryPath
    );

  checks.push(security);

  await emitProgress(
    "security",
    "Dependency Security",
    toProgressStatus(security.status),
    security.summary
  );
} else {
  const preparationSummary =
    preparation.summary;

  const unavailableChecks: CheckResult[] = [
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

  checks.push(...unavailableChecks);

  for (const check of unavailableChecks) {
    await emitProgress(
      check.category,
      check.name,
      "error",
      check.summary
    );
  }
}

    function toProgressStatus(
  status: CheckResult["status"]
): AssessmentProgressStatus {
  return status;
}

    const readiness =
      calculateReadinessScore(
        checks
      );

    let architecture:
      | ArchitectureAnalysis
      | undefined;

    let verification:
      | RemoteReadinessAssessment["verification"]
      | undefined;

    /*
     * AI analysis is optional.
     * Deterministic readiness reporting
     * must still work if the model is
     * unavailable.
     */

    await emitProgress(
  "architect",
  "Nemotron Analysis",
  "running",
  "Analyzing verified repository evidence..."
    );
    
    try {
  const analysis =
    await runArchitectAgent(scan);

  const verified =
    verifyArchitectureAnalysis(
      scan,
      analysis
    );

  architecture = {
    ...analysis,
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
} catch (error) {
  architecture = undefined;
  verification = undefined;

  const diagnostic =
    error instanceof Error
      ? error.message
      : "Unknown Nemotron analysis error.";

  console.error(
    "[DeployGuard Architect Agent]",
    diagnostic
  );

  await emitProgress(
    "architect",
    "Nemotron Analysis",
    "error",
    `AI architecture analysis was unavailable: ${diagnostic}`
  );
}

    const report =
      createProductionReadinessReport(
        scan,
        checks,
        readiness,
        architecture
      );

      await emitProgress(
  "report",
  "Readiness Report",
  "running",
  "Calculating readiness and generating the final report..."
    );

    /*
     * Do not expose the temporary filesystem
     * path in the public report.
     */
    report.repository.path =
      repository.fullName;

      await emitProgress(
  "report",
  "Readiness Report",
  "completed",
  `Assessment completed with readiness score ${readiness.score}/100.`
  );

    return {
      repository: {
        owner: repository.owner,
        name: repository.name,
        fullName: repository.fullName,
        url: repository.url,
      },

      report,
      verification,
    };
  } finally {
    ingested.cleanup();
  }
}