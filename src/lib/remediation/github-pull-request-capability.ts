import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export interface GitHubPullRequestCapability {
  repositoryIdentity: string;

  deliveryId: string;
  artifactSha256: string;

  headBranch: string;
  headCommitSha: string;

  baseBranch: string;
  baseHeadSha: string;

  permission:
    "create_verified_remediation_pull_request";

  issuedAt: number;
  expiresAt: number;
}

export interface SignedGitHubPullRequestCapability {
  capability:
    GitHubPullRequestCapability;

  signature: string;
}

const CAPABILITY_TTL_MS =
  5 * 60 * 1000;

function serializeCapability(
  capability:
    GitHubPullRequestCapability
): string {
  return JSON.stringify({
    repositoryIdentity:
      capability.repositoryIdentity,

    deliveryId:
      capability.deliveryId,

    artifactSha256:
      capability.artifactSha256,

    headBranch:
      capability.headBranch,

    headCommitSha:
      capability.headCommitSha,

    baseBranch:
      capability.baseBranch,

    baseHeadSha:
      capability.baseHeadSha,

    permission:
      capability.permission,

    issuedAt:
      capability.issuedAt,

    expiresAt:
      capability.expiresAt,
  });
}

function createSignature(
  capability:
    GitHubPullRequestCapability,
  secret: string
): string {
  return createHmac(
    "sha256",
    secret
  )
    .update(
      serializeCapability(
        capability
      )
    )
    .digest("hex");
}

export function issueGitHubPullRequestCapability(
  repositoryIdentity: string,
  deliveryId: string,
  artifactSha256: string,
  headBranch: string,
  headCommitSha: string,
  baseBranch: string,
  baseHeadSha: string,
  now = Date.now()
): GitHubPullRequestCapability {
  return {
    repositoryIdentity,
    deliveryId,
    artifactSha256,
    headBranch,
    headCommitSha,
    baseBranch,
    baseHeadSha,

    permission:
      "create_verified_remediation_pull_request",

    issuedAt: now,

    expiresAt:
      now +
      CAPABILITY_TTL_MS,
  };
}

export function signGitHubPullRequestCapability(
  capability:
    GitHubPullRequestCapability,
  secret: string
): SignedGitHubPullRequestCapability {
  if (!secret) {
    throw new Error(
      "GitHub pull request capability signing secret is required."
    );
  }

  return {
    capability,

    signature:
      createSignature(
        capability,
        secret
      ),
  };
}

export function verifySignedGitHubPullRequestCapability(
  signed:
    SignedGitHubPullRequestCapability,
  secret: string
): boolean {
  if (
    !secret ||
    !signed.signature
  ) {
    return false;
  }

  const expectedSignature =
    createSignature(
      signed.capability,
      secret
    );

  const actualBuffer =
    Buffer.from(
      signed.signature,
      "hex"
    );

  const expectedBuffer =
    Buffer.from(
      expectedSignature,
      "hex"
    );

  if (
    actualBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    actualBuffer,
    expectedBuffer
  );
}

export function validateGitHubPullRequestCapability(
  capability:
    GitHubPullRequestCapability,
  repositoryIdentity: string,
  deliveryId: string,
  artifactSha256: string,
  headBranch: string,
  headCommitSha: string,
  baseBranch: string,
  baseHeadSha: string,
  now = Date.now()
): boolean {
  return (
    capability.permission ===
      "create_verified_remediation_pull_request" &&

    capability.repositoryIdentity ===
      repositoryIdentity &&

    capability.deliveryId ===
      deliveryId &&

    capability.artifactSha256 ===
      artifactSha256 &&

    capability.headBranch ===
      headBranch &&

    capability.headCommitSha ===
      headCommitSha &&

    capability.baseBranch ===
      baseBranch &&

    capability.baseHeadSha ===
      baseHeadSha &&

    capability.issuedAt <= now &&

    capability.expiresAt > now
  );
}