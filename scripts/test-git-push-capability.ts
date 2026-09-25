import {
  issueGitPushCapability,
  signGitPushCapability,
  validateGitPushCapability,
  verifySignedGitPushCapability,
} from "@/lib/remediation/git-push-capability";

const signingSecret =
  "deployguard-test-push-secret";

const repositoryIdentity =
  "gevalinho/deployguard-test";

const remoteName =
  "origin";

const branchName =
  "deployguard/remediation-abc123";

const commitSha =
  "1111111111111111111111111111111111111111";

const artifactSha256 =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const capability =
  issueGitPushCapability(
    repositoryIdentity,
    remoteName,
    branchName,
    commitSha,
    artifactSha256
  );

const signed =
  signGitPushCapability(
    capability,
    signingSecret
  );

/*
 * A correctly signed capability must verify.
 */

if (
  !verifySignedGitPushCapability(
    signed,
    signingSecret
  )
) {
  throw new Error(
    "Valid Git push capability signature was rejected."
  );
}

console.log(
  "✓ Valid Git push capability signature accepted."
);

/*
 * The capability must authorize only the exact
 * repository, remote, branch, commit and artifact.
 */

if (
  !validateGitPushCapability(
    signed.capability,
    repositoryIdentity,
    remoteName,
    branchName,
    commitSha,
    artifactSha256
  )
) {
  throw new Error(
    "Exact Git push scope was rejected."
  );
}

console.log(
  "✓ Exact verified push scope authorized."
);

const expectRejected = (
  label: string,
  repository:
    string = repositoryIdentity,
  remote:
    string = remoteName,
  branch:
    string = branchName,
  commit:
    string = commitSha,
  artifact:
    string = artifactSha256
) => {
  if (
    validateGitPushCapability(
      signed.capability,
      repository,
      remote,
      branch,
      commit,
      artifact
    )
  ) {
    throw new Error(
      `${label} unexpectedly authorized Git push.`
    );
  }

  console.log(
    `✓ ${label} rejected.`
  );
};

expectRejected(
  "Cross-repository push",
  "attacker/other-repository"
);

expectRejected(
  "Cross-remote push",
  repositoryIdentity,
  "upstream"
);

expectRejected(
  "Cross-branch push",
  repositoryIdentity,
  remoteName,
  "main"
);

expectRejected(
  "Cross-commit push",
  repositoryIdentity,
  remoteName,
  branchName,
  "2222222222222222222222222222222222222222"
);

expectRejected(
  "Cross-artifact push",
  repositoryIdentity,
  remoteName,
  branchName,
  commitSha,
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
);

/*
 * Expired authorization must fail.
 */

const now =
  Date.now();

const expired =
  issueGitPushCapability(
    repositoryIdentity,
    remoteName,
    branchName,
    commitSha,
    artifactSha256,
    now - 10 * 60 * 1000
  );

if (
  validateGitPushCapability(
    expired,
    repositoryIdentity,
    remoteName,
    branchName,
    commitSha,
    artifactSha256,
    now
  )
) {
  throw new Error(
    "Expired Git push capability was accepted."
  );
}

console.log(
  "✓ Expired Git push capability rejected."
);

/*
 * A different signing secret must not verify.
 */

if (
  verifySignedGitPushCapability(
    signed,
    "wrong-secret"
  )
) {
  throw new Error(
    "Wrong signing secret verified Git push capability."
  );
}

console.log(
  "✓ Wrong signing secret rejected."
);

/*
 * Mutating signed scope after issuance must
 * invalidate the cryptographic signature.
 */

const tampered = {
  ...signed,

  capability: {
    ...signed.capability,

    branchName:
      "main",
  },
};

if (
  verifySignedGitPushCapability(
    tampered,
    signingSecret
  )
) {
  throw new Error(
    "Tampered Git push capability passed signature verification."
  );
}

console.log(
  "✓ Tampered signed push scope rejected."
);

console.log(
  "\n✓ Verified Git Push capability boundary passed."
);