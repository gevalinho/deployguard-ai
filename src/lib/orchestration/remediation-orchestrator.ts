import {
  runSandboxBuildAgent,
} from "@/lib/agents/sandbox-build-agent";

import {
  runSandboxLintAgent,
} from "@/lib/agents/sandbox-lint-agent";

import {
  runSandboxSecurityAgent,
  parseNpmStyleAuditReport,
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
  createVerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

import {
  parseGitHubRepositoryUrl,
} from "@/lib/repository/github-repository";

import {
  ingestGitHubRepository,
} from "@/lib/repository/repository-ingestion";
import type { RepositoryReadTransportFactory } from "@/lib/repository/github-read-transport";
import { validArtifact } from "@/lib/remediation/developer-delivery-api";

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

import {
  captureWorkspaceSnapshot,
  createVerifiedPatch,
  isDependencyFile,
} from "@/lib/remediation/verified-patch";

import {
  persistProvenRemediationArtifact,
} from "@/lib/remediation/verified-remediation-persistence";

export interface RemoteRemediationResult {
  sourceCommitSha?: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
    url: string;
  };

  remediation:
    PublicRemediationRun;
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

  return checks;
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
  proposal: FixProposal,
  readTransportFactory?: RepositoryReadTransportFactory,
): Promise<RemoteRemediationResult> {
  const repository =
    parseGitHubRepositoryUrl(
      repositoryUrl
    );

  const ingested =
    await ingestGitHubRepository(
      repository,
      undefined,
      readTransportFactory,
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

if (proposal.strategy === "dependency_security") {
  if (!proposal.packageName || !proposal.advisoryId ||
      !/^[0-9]{1,20}$/.test(proposal.advisoryId)) {
    throw new Error("A package and stable advisory identity are required for dependency remediation.");
  }
  const baselineFindings = parseNpmStyleAuditReport(before.stdout ?? "");
  if (!proposal.advisoryId || !/^[0-9]{1,20}$/.test(proposal.advisoryId) ||
      !baselineFindings || baselineFindings.filter((finding) =>
        finding.packageName.toLowerCase() === proposal.packageName!.toLowerCase() &&
        finding.advisoryIds?.includes(proposal.advisoryId!)).length !== 1) {
    throw new Error("The targeted advisory could not be uniquely confirmed in the fresh baseline audit.");
  }
  const selected = referencedEvidence[0];
  const packageStillPresent = referencedEvidence.length === 1 &&
    selected.kind === "security_finding" &&
    selected.message.toLowerCase() ===
      `${proposal.packageName.toLowerCase()} has a ${selected.code}-severity dependency vulnerability.` &&
    (selected.code === "high" || selected.code === "critical") &&
    Array.isArray(selected.advisoryIds) &&
    selected.advisoryIds.filter((id) => id === proposal.advisoryId).length === 1 &&
    selected.advisoryIds.every((id) => /^[0-9]{1,20}$/.test(id));

  if (!packageStillPresent) {
    throw new Error(
      `The requested package finding (${proposal.packageName}) could not be reproduced against the current repository state.`
    );
  }
}


/*
 * Capture the verified repository state before
 * any controlled mutation occurs.
 *
 * This snapshot becomes the baseline for a patch
 * only if remediation is independently proven.
 */
const workspaceBefore =
  captureWorkspaceSnapshot(
    ingested.repositoryPath
  );

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

let dependencyAfterFix: ReturnType<typeof captureWorkspaceSnapshot> | undefined;
if (proposal.strategy === "dependency_security") {
  try { dependencyAfterFix = captureWorkspaceSnapshot(ingested.repositoryPath); }
  catch {
    execution.status = "failed";
    execution.summary = "Dependency files could not be safely captured after remediation.";
    return {
      repository: { owner: repository.owner, name: repository.name,
        fullName: repository.fullName, url: repository.url },
      remediation: sanitizeRemediationForPublic(remediation),
    };
  }
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
        regressionChecks,
        proposal.packageName,
        ["types", "lint", "test", "build"],
        proposal.advisoryId,
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

/*
 * A workspace diff is considered verified only
 * when independent remediation proof succeeds.
 *
 * Failed or inconclusive remediation must never
 * produce a verified patch.
 */
if (proof.status === "proven") {
  let verifiedPatch: ReturnType<typeof createVerifiedPatch>;
  try {
    const workspaceAfter = captureWorkspaceSnapshot(ingested.repositoryPath);
    if (proposal.strategy === "dependency_security") {
      const paths = new Set([
        ...dependencyAfterFix!.dependencyHashes.keys(),
        ...workspaceAfter.dependencyHashes.keys(),
      ]);
      if ([...paths].some((path) =>
        dependencyAfterFix!.dependencyHashes.get(path) !== workspaceAfter.dependencyHashes.get(path))) {
        throw new Error("Dependency files changed during validation.");
      }
    }
    verifiedPatch = createVerifiedPatch(workspaceBefore, workspaceAfter);
    if (proposal.strategy === "dependency_security" &&
        verifiedPatch.files.some((file) => !isDependencyFile(file.path))) {
      throw new Error("Remediation changed files outside dependency manifests and lockfiles.");
    }
  } catch {
    proof.status = "inconclusive";
    proof.summary = "The audited dependency changes could not be captured completely and exclusively in a verified artifact.";
    if (proposal.strategy === "dependency_security") console.error("[DeployGuard Remediation Approval]", {
      overallRemediationApprovalStatus: "rejected_patch_checks",
    });
    remediation.proof = proof;
    return {
      sourceCommitSha: ingested.provenance.commitSha,
      repository: { owner: repository.owner, name: repository.name,
        fullName: repository.fullName, url: repository.url },
      remediation: sanitizeRemediationForPublic(remediation),
    };
  }

  if (verifiedPatch.fileCount === 0) {
    proof.status = "not_proven";
    proof.summary = "The audit passed, but remediation produced no deliverable file changes.";
    remediation.proof = proof;
    return {
      sourceCommitSha: ingested.provenance.commitSha,
      repository: {
        owner: repository.owner, name: repository.name,
        fullName: repository.fullName, url: repository.url,
      },
      remediation: sanitizeRemediationForPublic(remediation),
    };
  }

  remediation.verifiedPatch =
    verifiedPatch;


const verifiedPatchArtifact =
  createVerifiedPatchArtifact(
    verifiedPatch
  );

remediation.verifiedPatchArtifact =
  verifiedPatchArtifact;

// Dependency remediation remains observation-only during controlled production
// testing. Without a persisted artifact ID, the delivery API cannot create a PR.
if (proposal.strategy === "dependency_security") {
  console.error("[DeployGuard Remediation Approval]", {
    overallRemediationApprovalStatus: "verified_observation_only",
  });
  remediation.proof = proof;
  return {
    sourceCommitSha: ingested.provenance.commitSha,
    repository: { owner: repository.owner, name: repository.name,
      fullName: repository.fullName, url: repository.url },
    remediation: sanitizeRemediationForPublic(remediation),
  };
}

/*
 * Persist source-bearing remediation evidence
 * only after independent verification succeeds.
 *
 * Persistence records verified evidence.
 * It does not authorize delivery, commit,
 * or push operations.
 */
const persistedArtifact =
  await persistProvenRemediationArtifact(
    repository.fullName,
    proof.status,
    verifiedPatchArtifact,
    ingested.provenance
  );

if (!persistedArtifact) {
  throw new Error(
    "Proven remediation artifact was not persisted."
  );
}

// Only durable evidence leaves remediation. Delivery is a separate request.
remediation.verifiedArtifactReference = {
  artifactId: persistedArtifact.id,
  deliveryEligible: validArtifact(persistedArtifact),
};

console.log(
  `[DeployGuard Remediation] Verified artifact persisted: ${persistedArtifact.id}, SHA-256 ${persistedArtifact.sha256}.`
);

console.log(
  `[DeployGuard Remediation] Verified patch artifact generated: ${verifiedPatchArtifact.byteSize} bytes, SHA-256 ${verifiedPatchArtifact.sha256}.`
);


  console.log(
    `[DeployGuard Remediation] Verified patch captured: ${verifiedPatch.fileCount} changed file(s).`
  );
}

remediation.proof =
  proof;

    return {
      sourceCommitSha: ingested.provenance.commitSha,
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
