import {
  issueGitHubPullRequestCapability,
  signGitHubPullRequestCapability,
  validateGitHubPullRequestCapability,
  verifySignedGitHubPullRequestCapability,
  type SignedGitHubPullRequestCapability,
} from "@/lib/remediation/github-pull-request-capability";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function cloneSigned(
  signed: SignedGitHubPullRequestCapability
): SignedGitHubPullRequestCapability {
  return {
    capability: {
      ...signed.capability,
    },
    signature:
      signed.signature,
  };
}

function main(): void {
  const signingSecret =
    "deployguard-test-pr-secret";

  const now =
    1_800_000_000_000;

  const repositoryIdentity =
    "gevalinho/deployguard-ai";

  const deliveryId =
    "delivery-test-001";

  const artifactSha256 =
    "a".repeat(64);

  const headBranch =
    "deployguard/remediation-aaaaaaaaaaaa";

  const headCommitSha =
    "b".repeat(40);

  const baseBranch =
    "main";

  const baseHeadSha =
    "c".repeat(40);

  const capability =
    issueGitHubPullRequestCapability(
      repositoryIdentity,
      deliveryId,
      artifactSha256,
      headBranch,
      headCommitSha,
      baseBranch,
      baseHeadSha,
      now
    );

  const signed =
    signGitHubPullRequestCapability(
      capability,
      signingSecret
    );

  assert(
    verifySignedGitHubPullRequestCapability(
      signed,
      signingSecret
    ),
    "Valid PR capability signature was rejected."
  );

  assert(
    validateGitHubPullRequestCapability(
      capability,
      repositoryIdentity,
      deliveryId,
      artifactSha256,
      headBranch,
      headCommitSha,
      baseBranch,
      baseHeadSha,
      now
    ),
    "Valid PR capability was rejected."
  );

  console.log(
    "✓ Valid PR capability accepted."
  );

  const mutations: Array<{
    name: string;
    mutate: (
      value:
        SignedGitHubPullRequestCapability
    ) => void;
  }> = [
    {
      name:
        "repository substitution",
      mutate: (value) => {
        value.capability.repositoryIdentity =
          "attacker/other-repository";
      },
    },
    {
      name:
        "delivery substitution",
      mutate: (value) => {
        value.capability.deliveryId =
          "delivery-attacker";
      },
    },
    {
      name:
        "artifact substitution",
      mutate: (value) => {
        value.capability.artifactSha256 =
          "d".repeat(64);
      },
    },
    {
      name:
        "head branch substitution",
      mutate: (value) => {
        value.capability.headBranch =
          "main";
      },
    },
    {
      name:
        "head commit substitution",
      mutate: (value) => {
        value.capability.headCommitSha =
          "e".repeat(40);
      },
    },
    {
      name:
        "base branch substitution",
      mutate: (value) => {
        value.capability.baseBranch =
          "production";
      },
    },
    {
      name:
        "base HEAD substitution",
      mutate: (value) => {
        value.capability.baseHeadSha =
          "f".repeat(40);
      },
    },
  ];

  for (
    const mutation
    of mutations
  ) {
    const tampered =
      cloneSigned(
        signed
      );

    mutation.mutate(
      tampered
    );

    assert(
      !verifySignedGitHubPullRequestCapability(
        tampered,
        signingSecret
      ),
      `${mutation.name} did not invalidate the signature.`
    );

    console.log(
      `✓ ${mutation.name} rejected.`
    );
  }

  const wrongSignature =
    cloneSigned(
      signed
    );

  wrongSignature.signature =
    "0".repeat(
      signed.signature.length
    );

  assert(
    !verifySignedGitHubPullRequestCapability(
      wrongSignature,
      signingSecret
    ),
    "Tampered signature was accepted."
  );

  console.log(
    "✓ Signature tampering rejected."
  );

  assert(
    !verifySignedGitHubPullRequestCapability(
      signed,
      "wrong-secret"
    ),
    "Capability verified with wrong signing secret."
  );

  console.log(
    "✓ Wrong signing secret rejected."
  );

  assert(
    !validateGitHubPullRequestCapability(
      capability,
      repositoryIdentity,
      deliveryId,
      artifactSha256,
      headBranch,
      headCommitSha,
      baseBranch,
      baseHeadSha,
      capability.expiresAt
    ),
    "Expired PR capability was accepted."
  );

  console.log(
    "✓ Expired capability rejected."
  );

  const futureCapability =
    issueGitHubPullRequestCapability(
      repositoryIdentity,
      deliveryId,
      artifactSha256,
      headBranch,
      headCommitSha,
      baseBranch,
      baseHeadSha,
      now + 60_000
    );

  assert(
    !validateGitHubPullRequestCapability(
      futureCapability,
      repositoryIdentity,
      deliveryId,
      artifactSha256,
      headBranch,
      headCommitSha,
      baseBranch,
      baseHeadSha,
      now
    ),
    "Future-issued PR capability was accepted."
  );

  console.log(
    "✓ Future-issued capability rejected."
  );

  /*
   * A legitimately signed capability must still
   * be unusable for different runtime facts.
   *
   * Signature authenticity proves who issued
   * authority. Runtime validation proves what
   * that authority permits.
   */
  assert(
    !validateGitHubPullRequestCapability(
      capability,
      repositoryIdentity,
      deliveryId,
      artifactSha256,
      headBranch,
      headCommitSha,
      "production",
      baseHeadSha,
      now
    ),
    "Valid signature authorized a different base branch."
  );

  console.log(
    "✓ Signed authority cannot target a different base branch."
  );

  assert(
    !validateGitHubPullRequestCapability(
      capability,
      repositoryIdentity,
      deliveryId,
      artifactSha256,
      headBranch,
      "9".repeat(40),
      baseBranch,
      baseHeadSha,
      now
    ),
    "Valid signature authorized a different remediation commit."
  );

  console.log(
    "✓ Signed authority cannot target a different remediation commit."
  );

  console.log(
    "\n✓ GitHub Pull Request capability boundary passed."
  );
}

main();