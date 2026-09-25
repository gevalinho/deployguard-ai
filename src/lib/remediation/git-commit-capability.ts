import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export interface GitCommitCapability {
  permission:
    "commit_verified_remediation";

  artifactSha256: string;

  originalHead: string;

  branchName: string;

  preparedDiffSha256: string;

  issuedAt: number;
  expiresAt: number;
}

export interface SignedGitCommitCapability {
  capability:
    GitCommitCapability;

  signature: string;
}

const COMMIT_CAPABILITY_TTL_MS =
  5 * 60 * 1000;

function serializeGitCommitCapability(
  capability: GitCommitCapability
): string {
  return JSON.stringify({
    permission:
      capability.permission,

    artifactSha256:
      capability.artifactSha256,

    originalHead:
      capability.originalHead,

    branchName:
      capability.branchName,

    issuedAt:
      capability.issuedAt,

    expiresAt:
      capability.expiresAt,

    preparedDiffSha256:
  capability.preparedDiffSha256,  
  });
}

function createSignature(
  capability: GitCommitCapability,
  secret: string
): string {
  return createHmac(
    "sha256",
    secret
  )
    .update(
      serializeGitCommitCapability(
        capability
      )
    )
    .digest("hex");
}

// export function issueGitCommitCapability(
//   artifactSha256: string,
//   originalHead: string,
//   branchName: string,
//   now = Date.now()
// ): GitCommitCapability {
//   return {
//     permission:
//       "commit_verified_remediation",

//     artifactSha256,
//     originalHead,
//     branchName,

//     issuedAt: now,

//     expiresAt:
//       now +
//       COMMIT_CAPABILITY_TTL_MS,
//   };
// }

export function issueGitCommitCapability(
  artifactSha256: string,
  originalHead: string,
  branchName: string,
  preparedDiffSha256: string,
  now = Date.now()
): GitCommitCapability {
  return {
    permission:
      "commit_verified_remediation",

    artifactSha256,
    originalHead,
    branchName,
    preparedDiffSha256,

    issuedAt: now,

    expiresAt:
      now +
      COMMIT_CAPABILITY_TTL_MS,
  };
}

export function signGitCommitCapability(
  capability: GitCommitCapability,
  secret: string
): SignedGitCommitCapability {
  if (!secret) {
    throw new Error(
      "Git commit capability signing secret is required."
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

export function verifySignedGitCommitCapability(
  signed:
    SignedGitCommitCapability,
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

// export function validateGitCommitCapability(
//   capability:
//     GitCommitCapability,

//   artifactSha256: string,
//   originalHead: string,
//   branchName: string,

//   now = Date.now()
// ): boolean {
//   return (
//     capability.permission ===
//       "commit_verified_remediation" &&

//     capability.artifactSha256 ===
//       artifactSha256 &&

//     capability.originalHead ===
//       originalHead &&

//     capability.branchName ===
//       branchName &&

//     capability.issuedAt <= now &&

//     capability.expiresAt > now
//   );
// }

export function validateGitCommitCapability(
  capability:
    GitCommitCapability,

  artifactSha256: string,
  originalHead: string,
  branchName: string,
  preparedDiffSha256: string,

  now = Date.now()
): boolean {
  return (
    capability.permission ===
      "commit_verified_remediation" &&

    capability.artifactSha256 ===
      artifactSha256 &&

    capability.originalHead ===
      originalHead &&

    capability.branchName ===
      branchName &&

    capability.preparedDiffSha256 ===
      preparedDiffSha256 &&

    capability.issuedAt <= now &&

    capability.expiresAt > now
  );
}