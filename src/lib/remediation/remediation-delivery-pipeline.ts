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
} from "@/lib/remediation/remediation-delivery-repository";

import {
  getTrustedVerifiedArtifact,
} from "@/lib/remediation/trusted-artifact-repository";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

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