import {
  issueGitCommitCapability,
  signGitCommitCapability,
  validateGitCommitCapability,
  verifySignedGitCommitCapability,
} from "@/lib/remediation/git-commit-capability";

const signingSecret =
  "deployguard-test-signing-secret";

const artifactSha256 =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const originalHead =
  "1111111111111111111111111111111111111111";

const branchName =
  "deployguard/remediation-aaaaaaaaaaaa";

const preparedDiffSha256 =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const capability =
  issueGitCommitCapability(
    artifactSha256,
    originalHead,
    branchName,
    preparedDiffSha256
  );

const signed =
  signGitCommitCapability(
    capability,
    signingSecret
  );

/*
 * A correctly signed capability must verify.
 */
if (
  !verifySignedGitCommitCapability(
    signed,
    signingSecret
  )
) {
  throw new Error(
    "Valid Git commit capability signature was rejected."
  );
}

console.log(
  "✓ Valid Git commit capability signature accepted."
);

/*
 * The capability must also match the exact
 * remediation state it authorizes.
 */
if (
  !validateGitCommitCapability(
    signed.capability,
    artifactSha256,
    originalHead,
    branchName,
    preparedDiffSha256
  )
) {
  throw new Error(
    "Valid Git commit capability scope was rejected."
  );
}

console.log(
  "✓ Exact remediation commit scope authorized."
);

/*
 * Changing artifact identity must invalidate
 * the signed capability.
 */
const tamperedArtifact = {
  ...signed,

  capability: {
    ...signed.capability,

    artifactSha256:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
};

if (
  verifySignedGitCommitCapability(
    tamperedArtifact,
    signingSecret
  )
) {
  throw new Error(
    "Tampered artifact identity passed Git commit signature verification."
  );
}

console.log(
  "✓ Tampered artifact identity rejected."
);

/*
 * A valid signature must not authorize another
 * original repository HEAD.
 */
if (
  validateGitCommitCapability(
    signed.capability,
    artifactSha256,
    "2222222222222222222222222222222222222222",
    branchName,
    preparedDiffSha256
  )
) {
  throw new Error(
    "Git commit capability authorized another original HEAD."
  );
}

console.log(
  "✓ Cross-HEAD commit authorization rejected."
);

/*
 * A valid signature must not authorize another
 * remediation branch.
 */
if (
  validateGitCommitCapability(
    signed.capability,
    artifactSha256,
    originalHead,
    preparedDiffSha256,
    "deployguard/remediation-other"
  )
) {
  throw new Error(
    "Git commit capability authorized another remediation branch."
  );
}

console.log(
  "✓ Cross-branch commit authorization rejected."
);

/*
 * Expired capabilities must not authorize a
 * commit.
 */
const expiredNow =
  signed.capability.expiresAt +
  1;

if (
  validateGitCommitCapability(
    signed.capability,
    artifactSha256,
    originalHead,
    branchName,
    preparedDiffSha256,
    expiredNow,
    
  )
) {
  throw new Error(
    "Expired Git commit capability was accepted."
  );
}


/*
 * A capability for one prepared repository
 * state must never authorize another state.
 */
if (
  validateGitCommitCapability(
    signed.capability,
    artifactSha256,
    originalHead,
    branchName,
    "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  )
) {
  throw new Error(
    "Git commit capability authorized a different prepared Git state."
  );
}

console.log(
  "✓ Cross-state commit authorization rejected."
);

console.log(
  "✓ Expired Git commit capability rejected."
);

/*
 * A capability signed with another secret must
 * not verify.
 */
if (
  verifySignedGitCommitCapability(
    signed,
    "wrong-secret"
  )
) {
  throw new Error(
    "Git commit capability verified with the wrong secret."
  );
}

console.log(
  "✓ Wrong signing secret rejected."
);