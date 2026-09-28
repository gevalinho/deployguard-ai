import {
  issueArtifactAccessCapability,
} from "@/lib/remediation/artifact-access-capability";

import {
  signArtifactAccessCapability,
} from "@/lib/remediation/artifact-capability-signing";

import {
  prepareVerifiedGitDelivery,
  type GitDeliveryResult,
} from "@/lib/remediation/git-delivery";

import {
  createPreparedDelivery,
  type RemediationDeliveryMetadata,
  getRemediationDelivery,
  markDeliveryCommitted,
} from "@/lib/remediation/remediation-delivery-repository";

import {
  getTrustedVerifiedArtifact,
  getVerifiedArtifactMetadata,
} from "@/lib/remediation/trusted-artifact-repository";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

import {
  issueGitCommitCapability,
  signGitCommitCapability,
} from "@/lib/remediation/git-commit-capability";

import {
  executeVerifiedGitCommit,
  type GitCommitExecutionResult,
} from "@/lib/remediation/git-commit-executor";

import {
  issueGitPushCapability,
  signGitPushCapability,
} from "@/lib/remediation/git-push-capability";

import {
  executeVerifiedGitPush,
  type GitPushExecutionResult,
} from "@/lib/remediation/git-push-executor";

import {
  createRemediationBranchName,
} from "@/lib/remediation/git-delivery";

import {
  markDeliveryPushed,
} from "@/lib/remediation/remediation-delivery-repository";


export interface PreparePersistedRemediationDeliveryResult {
  status:
    | "prepared"
    | "artifact_not_found"
    | "artifact_invalid"
    | "repository_mismatch"
    | "delivery_denied"
    | "delivery_failed";

  artifactId: string;

  artifactSha256?: string;

  delivery?:
    RemediationDeliveryMetadata;

  gitDelivery?:
    GitDeliveryResult;

  summary: string;
}

export interface CommitPersistedRemediationDeliveryResult {
  status:
    | "committed"
    | "delivery_not_found"
    | "invalid_delivery_state"
    | "repository_mismatch"
    | "artifact_not_found"
    | "artifact_mismatch"
    | "commit_denied"
    | "commit_failed"
    | "persistence_failed";

  deliveryId: string;

  artifactId?: string;
  artifactSha256?: string;
  commitSha?: string;

  delivery?:
    RemediationDeliveryMetadata;

  gitCommit?:
    GitCommitExecutionResult;

  summary: string;
}


export interface PersistedRemediationPushResult {
  status:
    | "pushed"
    | "delivery_not_found"
    | "invalid_delivery_state"
    | "repository_mismatch"
    | "invalid_remediation_branch"
    | "push_failed"
    | "persistence_failed";

  delivery?:
    RemediationDeliveryMetadata;

  gitPush?:
    GitPushExecutionResult;

  summary: string;
}

export async function pushPersistedRemediationDelivery(
  repositoryPath: string,
  repositoryIdentity: string,
  deliveryId: string,
  remoteName: string,
  signingSecret: string
): Promise<PersistedRemediationPushResult> {
  const delivery =
    await getRemediationDelivery(
      deliveryId
    );

  if (!delivery) {
    return {
      status:
        "delivery_not_found",

      summary:
        "Persisted remediation delivery was not found.",
    };
  }

  /*
   * Only an independently verified COMMITTED
   * delivery may cross the remote push boundary.
   */
  if (
    delivery.status !==
      "COMMITTED" ||
    !delivery.commitSha
  ) {
    return {
      status:
        "invalid_delivery_state",

      delivery,

      summary:
        "Only a committed remediation delivery may be pushed.",
    };
  }

  if (
    delivery.repositoryIdentity !==
    repositoryIdentity
  ) {
    return {
      status:
        "repository_mismatch",

      delivery,

      summary:
        "Persisted remediation delivery belongs to another repository.",
    };
  }

  /*
   * DeployGuard owns exactly one deterministic
   * branch for this verified artifact.
   *
   * Merely being a non-main branch is not enough.
   */
  const artifact =
    await getVerifiedArtifactMetadata(
      delivery.artifactId
    );

  if (!artifact) {
    return {
      status:
        "invalid_delivery_state",

      delivery,

      summary:
        "Verified remediation artifact metadata could not be recovered.",
    };
  }

  const expectedBranch =
    createRemediationBranchName(
      artifact.sha256
    );

  if (
    delivery.branchName !==
    expectedBranch
  ) {
    return {
      status:
        "invalid_remediation_branch",

      delivery,

      summary:
        "DeployGuard may push only the deterministic remediation branch owned by the verified artifact.",
    };
  }

  const capability =
    issueGitPushCapability(
      repositoryIdentity,
      remoteName,
      delivery.branchName,
      delivery.commitSha,
      artifact.sha256
    );

  const signedCapability =
    signGitPushCapability(
      capability,
      signingSecret
    );

  const gitPush =
    await executeVerifiedGitPush(
      repositoryPath,
      repositoryIdentity,
      artifact.sha256,
      signedCapability,
      signingSecret
    );

  if (
    gitPush.status !==
    "pushed"
  ) {
    return {
      status:
        "push_failed",

      delivery,
      gitPush,

      summary:
        gitPush.summary,
    };
  }

  /*
   * Git has already independently verified that
   * the remote branch resolves to the exact
   * authorized immutable commit.
   *
   * Only now may durable state become PUSHED.
   */
  const pushed =
    await markDeliveryPushed(
      delivery.id,
      remoteName
    );

  if (!pushed) {
    return {
      status:
        "persistence_failed",

      delivery,
      gitPush,

      summary:
        "Verified Git push succeeded but durable PUSHED transition failed.",
    };
  }

  return {
    status: "pushed",

    delivery:
      pushed,

    gitPush,

    summary:
      "Committed verified remediation was pushed to its isolated DeployGuard branch and durably recorded.",
  };
}


/*
 * Reconstruct a VerifiedPatchArtifact only after
 * validating the persisted representation.
 *
 * Database persistence is durable evidence,
 * not proof that arbitrary stored data should
 * automatically cross a mutation boundary.
 */
function reconstructVerifiedPatchArtifact(
  format: string,
  content: string,
  sha256: string,
  byteSize: number
): VerifiedPatchArtifact | null {
  if (
    format !== "unified_diff"
  ) {
    return null;
  }

  return {
    format,
    content,
    sha256,
    byteSize,
  };
}

export async function preparePersistedRemediationDelivery(
  repositoryPath: string,
  repositoryIdentity: string,
  artifactId: string,
  artifactSigningSecret: string
): Promise<PreparePersistedRemediationDeliveryResult> {
  /*
   * Retrieve source-bearing evidence only inside
   * this trusted server-side delivery boundary.
   */
  const stored =
    await getTrustedVerifiedArtifact(
      artifactId
    );

  if (!stored) {
    return {
      status:
        "artifact_not_found",

      artifactId,

      summary:
        "Persisted verified remediation artifact was not found.",
    };
  }

  /*
   * Prevent an artifact persisted for one
   * repository from being delivered into another.
   */
  if (
    stored.repositoryIdentity !==
    repositoryIdentity
  ) {
    return {
      status:
        "repository_mismatch",

      artifactId,

      artifactSha256:
        stored.sha256,

      summary:
        "Persisted artifact repository identity does not match the delivery repository.",
    };
  }

  const artifact =
    reconstructVerifiedPatchArtifact(
      stored.format,
      stored.content,
      stored.sha256,
      stored.byteSize
    );

  if (!artifact) {
    return {
      status:
        "artifact_invalid",

      artifactId,

      artifactSha256:
        stored.sha256,

      summary:
        "Persisted artifact format is not supported for Git delivery.",
    };
  }

  /*
   * Database retrieval does not authorize Git
   * mutation.
   *
   * Issue a short-lived capability scoped to the
   * exact immutable artifact identity and trusted
   * GitHub integration consumer.
   */
  const capability =
    issueArtifactAccessCapability(
      "github_integration",
      artifact.sha256
    );

  const signedCapability =
    signArtifactAccessCapability(
      capability,
      artifactSigningSecret
    );

  /*
   * Git delivery independently verifies:
   *
   * - capability authenticity
   * - consumer authorization
   * - artifact SHA-256
   * - artifact byte size
   * - clean Git workspace
   * - original HEAD
   * - patch applicability
   * - resulting repository changes
   * - exact prepared diff identity
   */
  const gitDelivery =
    await prepareVerifiedGitDelivery(
      repositoryPath,
      artifact,
      signedCapability,
      artifactSigningSecret
    );

  if (
    gitDelivery.status !==
    "prepared"
  ) {
    return {
      status:
        gitDelivery.status ===
        "denied"
          ? "delivery_denied"
          : "delivery_failed",

      artifactId,

      artifactSha256:
        artifact.sha256,

      gitDelivery,

      summary:
        gitDelivery.summary,
    };
  }

  /*
   * Successful preparation must contain the
   * independently observed Git identities needed
   * for durable audit persistence.
   */
  if (
    !gitDelivery.originalHead ||
    !gitDelivery.branchName ||
    !gitDelivery.preparedDiffSha256
  ) {
    return {
      status:
        "delivery_failed",

      artifactId,

      artifactSha256:
        artifact.sha256,

      gitDelivery,

      summary:
        "Prepared Git delivery did not contain complete verification evidence.",
    };
  }

  /*
   * Persist PREPARED only after the real Git
   * preparation boundary succeeds.
   *
   * The database records what was proven.
   * It does not authorize the preparation.
   */
  const delivery =
    await createPreparedDelivery({
      artifactId,

      repositoryIdentity,

      originalHead:
        gitDelivery.originalHead,

      branchName:
        gitDelivery.branchName,

      preparedDiffSha256:
        gitDelivery.preparedDiffSha256,
    });

  return {
    status: "prepared",

    artifactId,

    artifactSha256:
      artifact.sha256,

    delivery,

    gitDelivery,

    summary:
      "Persisted verified artifact was safely prepared for Git delivery and recorded as PREPARED.",
  };
}

export async function commitPersistedRemediationDelivery(
  repositoryPath: string,
  repositoryIdentity: string,
  deliveryId: string,
  commitSigningSecret: string
): Promise<CommitPersistedRemediationDeliveryResult> {
  /*
   * Load durable evidence describing the exact
   * Git state that previously crossed the
   * PREPARED boundary.
   *
   * Persistence is evidence, not commit authority.
   */
  const delivery =
    await getRemediationDelivery(
      deliveryId
    );

  if (!delivery) {
    return {
      status:
        "delivery_not_found",

      deliveryId,

      summary:
        "Persisted remediation delivery was not found.",
    };
  }

  if (
    delivery.status !==
    "PREPARED"
  ) {
    return {
      status:
        "invalid_delivery_state",

      deliveryId,

      artifactId:
        delivery.artifactId,

      delivery,

      summary:
        `Remediation delivery is ${delivery.status}; only PREPARED delivery may cross the commit boundary.`,
    };
  }

  if (
    delivery.repositoryIdentity !==
    repositoryIdentity
  ) {
    return {
      status:
        "repository_mismatch",

      deliveryId,

      artifactId:
        delivery.artifactId,

      delivery,

      summary:
        "Persisted delivery repository identity does not match the commit repository.",
    };
  }

  /*
   * Recover the referenced immutable artifact
   * identity independently from persistence.
   */
  const artifact =
    await getTrustedVerifiedArtifact(
      delivery.artifactId
    );

  if (!artifact) {
    return {
      status:
        "artifact_not_found",

      deliveryId,

      artifactId:
        delivery.artifactId,

      delivery,

      summary:
        "Verified remediation artifact referenced by the delivery was not found.",
    };
  }

  if (
    artifact.repositoryIdentity !==
      repositoryIdentity ||
    artifact.repositoryIdentity !==
      delivery.repositoryIdentity
  ) {
    return {
      status:
        "artifact_mismatch",

      deliveryId,

      artifactId:
        delivery.artifactId,

      artifactSha256:
        artifact.sha256,

      delivery,

      summary:
        "Verified artifact identity does not match the persisted remediation delivery.",
    };
  }

  /*
   * Issue fresh, short-lived authority scoped to
   * the exact state that was previously proven:
   *
   * artifact
   * + original HEAD
   * + branch
   * + prepared diff.
   *
   * The database row itself does not authorize
   * the commit.
   */
  const capability =
    issueGitCommitCapability(
      artifact.sha256,
      delivery.originalHead,
      delivery.branchName,
      delivery.preparedDiffSha256
    );

  const signedCapability =
    signGitCommitCapability(
      capability,
      commitSigningSecret
    );

  /*
   * The executor independently re-observes Git
   * state before performing the mutation.
   */
  const gitCommit =
    await executeVerifiedGitCommit(
      repositoryPath,
      signedCapability,
      commitSigningSecret
    );

  if (
    gitCommit.status !==
    "committed"
  ) {
    return {
      status:
        gitCommit.status ===
        "denied"
          ? "commit_denied"
          : "commit_failed",

      deliveryId,

      artifactId:
        delivery.artifactId,

      artifactSha256:
        artifact.sha256,

      delivery,

      gitCommit,

      summary:
        gitCommit.summary,
    };
  }

  /*
   * A successful commit must return the immutable
   * commit identity before durable state may move
   * from PREPARED to COMMITTED.
   */
  if (!gitCommit.commitSha) {
    return {
      status:
        "commit_failed",

      deliveryId,

      artifactId:
        delivery.artifactId,

      artifactSha256:
        artifact.sha256,

      delivery,

      gitCommit,

      summary:
        "Verified Git commit succeeded without returning an immutable commit SHA.",
    };
  }

  /*
   * Persist the transition only after the real
   * Git commit boundary succeeds.
   *
   * markDeliveryCommitted() independently
   * enforces PREPARED -> COMMITTED atomically.
   */
  const committedDelivery =
    await markDeliveryCommitted(
      deliveryId,
      gitCommit.commitSha
    );

  if (!committedDelivery) {
    return {
      status:
        "persistence_failed",

      deliveryId,

      artifactId:
        delivery.artifactId,

      artifactSha256:
        artifact.sha256,

      commitSha:
        gitCommit.commitSha,

      delivery,

      gitCommit,

      summary:
        "Git commit succeeded, but the durable PREPARED to COMMITTED transition was rejected.",
    };
  }

  return {
    status:
      "committed",

    deliveryId,

    artifactId:
      delivery.artifactId,

    artifactSha256:
      artifact.sha256,

    commitSha:
      gitCommit.commitSha,

    delivery:
      committedDelivery,

    gitCommit,

    summary:
      "Prepared remediation was safely committed and durably recorded as COMMITTED.",
  };
}