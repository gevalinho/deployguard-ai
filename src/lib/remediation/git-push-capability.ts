import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export interface GitPushCapability {
  repositoryIdentity: string;
  remoteName: string;
  branchName: string;
  commitSha: string;
  artifactSha256: string;

  permission:
    "push_verified_remediation";

  issuedAt: number;
  expiresAt: number;
}

export interface SignedGitPushCapability {
  capability: GitPushCapability;
  signature: string;
}

const CAPABILITY_TTL_MS =
  5 * 60 * 1000;

function serializeCapability(
  capability: GitPushCapability
): string {
  return JSON.stringify({
    repositoryIdentity:
      capability.repositoryIdentity,
    remoteName:
      capability.remoteName,
    branchName:
      capability.branchName,
    commitSha:
      capability.commitSha,
    artifactSha256:
      capability.artifactSha256,
    permission:
      capability.permission,
    issuedAt:
      capability.issuedAt,
    expiresAt:
      capability.expiresAt,
  });
}

function createSignature(
  capability: GitPushCapability,
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

export function issueGitPushCapability(
  repositoryIdentity: string,
  remoteName: string,
  branchName: string,
  commitSha: string,
  artifactSha256: string,
  now = Date.now()
): GitPushCapability {
  return {
    repositoryIdentity,
    remoteName,
    branchName,
    commitSha,
    artifactSha256,

    permission:
      "push_verified_remediation",

    issuedAt: now,

    expiresAt:
      now +
      CAPABILITY_TTL_MS,
  };
}

export function signGitPushCapability(
  capability: GitPushCapability,
  secret: string
): SignedGitPushCapability {
  if (!secret) {
    throw new Error(
      "Git push capability signing secret is required."
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

export function verifySignedGitPushCapability(
  signed: SignedGitPushCapability,
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

export function validateGitPushCapability(
  capability: GitPushCapability,
  repositoryIdentity: string,
  remoteName: string,
  branchName: string,
  commitSha: string,
  artifactSha256: string,
  now = Date.now()
): boolean {
  return (
    capability.permission ===
      "push_verified_remediation" &&

    capability.repositoryIdentity ===
      repositoryIdentity &&

    capability.remoteName ===
      remoteName &&

    capability.branchName ===
      branchName &&

    capability.commitSha ===
      commitSha &&

    capability.artifactSha256 ===
      artifactSha256 &&

    capability.issuedAt <= now &&

    capability.expiresAt > now
  );
}