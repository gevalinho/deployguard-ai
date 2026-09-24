import {
  runSandboxBuildAgent,
} from "@/lib/agents/sandbox-build-agent";

import {
  runSandboxLintAgent,
} from "@/lib/agents/sandbox-lint-agent";

import {
  runSandboxSecurityAgent,
} from "@/lib/agents/sandbox-security-agent";

import {
  runSandboxTestAgent,
} from "@/lib/agents/sandbox-test-agent";

import {
  runSandboxTypecheckAgent,
} from "@/lib/agents/sandbox-typecheck-agent";

import type {
  CheckResult,
} from "@/lib/checks/types";

import {
  applyDependencySecurityFix,
} from "@/lib/remediation/dependency-security-fixer";

import {
  verifyDependencySecurityFix,
} from "@/lib/remediation/dependency-security-verifier";

import type {
  FixProposal,
  RemediationRun,
} from "@/lib/remediation/types";

import {
  parseGitHubRepositoryUrl,
} from "@/lib/repository/github-repository";

import {
  ingestGitHubRepository,
} from "@/lib/repository/repository-ingestion";

import {
  prepareSandboxWorkspace,
} from "@/lib/sandbox/workspace-preparation";

import {
  sanitizeRemediationForPublic,
  type PublicRemediationRun,
} from "@/lib/remediation/public-remediation";

import {
  applyLintAutofix,
} from "@/lib/remediation/lint-autofix-fixer";

import {
  verifyLintAutofix,
} from "@/lib/remediation/lint-autofix-verifier";

import {
  calculateReadinessScore,
  compareReadinessScores,
} from "@/lib/scoring/readiness-score";

export interface RemoteRemediationResult {
  repository: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
  };

  remediation:
    PublicRemediationRun;
}

function shouldRunRegressionCheck(
  check: CheckResult
): boolean {
  return (
    check.status !== "skipped" &&
    check.status !== "blocked" &&
    check.status !== "error"
  );
}

async function runRegressionChecks(
  repositoryPath: string
): Promise<CheckResult[]> {
  const checks =
    await Promise.all([
      runSandboxTypecheckAgent(
        repositoryPath
      ),

      runSandboxLintAgent(
        repositoryPath
      ),

      runSandboxTestAgent(
        repositoryPath
      ),

      runSandboxBuildAgent(
        repositoryPath
      ),
    ]);

  return checks.filter(
    shouldRunRegressionCheck
  );
}

function createRemediationReadinessImpact(
  before: CheckResult,
  after: CheckResult,
  regressionChecks: CheckResult[]
) {
  /*
   * Construct equivalent before/after verification
   * sets from checks actually executed during this
   * remediation run.
   *
   * The target check changes between the two sets.
   * Regression checks remain identical.
   */
  const beforeChecks = [
    ...regressionChecks,
    before,
  ];

  const afterChecks = [
    ...regressionChecks,
    after,
  ];

  const beforeReadiness =
    calculateReadinessScore(
      beforeChecks
    );

  const afterReadiness =
    calculateReadinessScore(
      afterChecks
    );

  return compareReadinessScores(
    beforeReadiness,
    afterReadiness
  );
}

export async function runRemoteRemediation(
  repositoryUrl: string,
  proposal: FixProposal
): Promise<RemoteRemediationResult> {
  const repository =
    parseGitHubRepositoryUrl(
      repositoryUrl
    );

  const ingested =
    await ingestGitHubRepository(
      repository
    );

  try {
    /*
     * Remediation always starts from a fresh
     * disposable repository workspace.
     *
     * Never trust an old assessment result as
     * sufficient evidence that the vulnerability
     * still exists.
     */

    const preparation =
      await prepareSandboxWorkspace(
        ingested.repositoryPath
      );

    if (
      preparation.status !== "passed"
    ) {
      throw new Error(
        `Remediation sandbox preparation failed: ${preparation.summary}`
      );
    }
/*
 * Re-detect the requested problem against the
 * fresh repository state.
 *
 * Each remediation strategy owns its deterministic
 * detector, controlled executor and independent
 * verifier.
 */

let before: CheckResult;

switch (proposal.strategy) {
  case "dependency_security":
    before =
      await runSandboxSecurityAgent(
        ingested.repositoryPath
      );

    if (
      proposal.target.checkId !== "security" ||
      proposal.target.category !== "security" ||
      before.id !== proposal.target.checkId
    ) {
      throw new Error(
        "The remediation proposal does not target the dependency security check."
      );
    }

    break;

  case "lint_autofix":
    before =
      await runSandboxLintAgent(
        ingested.repositoryPath
      );

    if (
      proposal.target.checkId !== "lint" ||
      proposal.target.category !== "lint" ||
      before.id !== proposal.target.checkId
    ) {
      throw new Error(
        "The remediation proposal does not target the lint check."
      );
    }

    break;

  default: {
    const unsupportedStrategy: never =
      proposal.strategy;

    throw new Error(
      `Unsupported remediation strategy: ${unsupportedStrategy}`
    );
  }
}

if (before.status !== "failed") {
  throw new Error(
    `The ${proposal.target.category} failure could not be reproduced against the current repository state.`
  );
}

/*
 * Verify that every evidence reference supplied
 * by the proposal still exists in the freshly
 * reproduced check result.
 */

const currentEvidence =
  before.evidence ?? [];

const referencedEvidence =
  proposal.target.evidenceIndexes
    .map(
      (index) =>
        currentEvidence[index]
    )
    .filter(
      (
        evidence
      ): evidence is NonNullable<
        typeof evidence
      > =>
        evidence !== undefined
    );

if (
  proposal.target.evidenceIndexes.length > 0 &&
  referencedEvidence.length !==
    proposal.target.evidenceIndexes.length
) {
  throw new Error(
    `The remediation proposal references ${proposal.target.category} evidence that no longer exists.`
  );
}

/*
 * Dependency security proposals may additionally
 * identify a package.
 *
 * Confirm that the package is still represented
 * by verified security evidence before mutation.
 */

if (
  proposal.strategy ===
    "dependency_security" &&
  proposal.packageName
) {
  const packageStillPresent =
    currentEvidence.some(
      (evidence) =>
        evidence.kind ===
          "security_finding" &&
        evidence.message
          .toLowerCase()
          .includes(
            proposal.packageName!
              .toLowerCase()
          )
    );

  if (!packageStillPresent) {
    throw new Error(
      `The requested package finding (${proposal.packageName}) could not be reproduced against the current repository state.`
    );
  }
}

/*
 * Apply the controlled mutation.
 *
 * The strategy determines the executor.
 * No arbitrary shell command crosses this
 * boundary from the AI or user.
 */

const execution =
  proposal.strategy ===
  "dependency_security"
    ? await applyDependencySecurityFix(
        ingested.repositoryPath,
        proposal
      )
    : await applyLintAutofix(
        ingested.repositoryPath,
        proposal
      );

const remediation: RemediationRun = {
  proposal,
  execution,
};

if (
  execution.status !== "applied"
) {
  return {
    repository: {
      owner: repository.owner,
      name: repository.name,
      fullName: repository.fullName,
      url: repository.url,
    },

    remediation:
      sanitizeRemediationForPublic(
        remediation
      ),
  };
}

/*
 * Re-run deterministic application checks after
 * mutation.
 *
 * The target check is independently executed by
 * its verifier below, so remove it from the
 * regression set. This prevents the target check
 * from proving itself twice.
 */

const allRegressionChecks =
  await runRegressionChecks(
    ingested.repositoryPath
  );

const regressionChecks =
  allRegressionChecks.filter(
    (check) =>
      check.id !==
      proposal.target.checkId
  );

/*
 * Independently verify the mutated repository.
 *
 * Successful execution alone is never proof.
 */

const proof =
  proposal.strategy ===
  "dependency_security"
    ? await verifyDependencySecurityFix(
        ingested.repositoryPath,
        before,
        regressionChecks
      )
    : await verifyLintAutofix(
        ingested.repositoryPath,
        before,
        regressionChecks
      );

const targetComparison =
  proof.comparisons.find(
    (comparison) =>
      comparison.checkId ===
      proposal.target.checkId
  );

if (targetComparison) {
  proof.readinessImpact =
    createRemediationReadinessImpact(
      targetComparison.before,
      targetComparison.after,
      regressionChecks
    );
}

remediation.proof =
  proof;

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

      // remediation,
      remediation:
  sanitizeRemediationForPublic(
    remediation
  ),
      
    };
  } finally {
    /*
     * The original GitHub repository is never
     * mutated.
     *
     * Every remediation attempt ends by deleting
     * its disposable workspace.
     */

    ingested.cleanup();
  }
}