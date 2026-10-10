import { describe, expect, it } from "vitest";

import {
  issueGitHubPullRequestCapability,
  signGitHubPullRequestCapability,
  verifySignedGitHubPullRequestCapability,
  validateGitHubPullRequestCapability,
} from "./github-pull-request-capability";

import {
  isVerifiedPullRequestIdentity,
} from "./github-pull-request-identity";

const repository = "owner/repo";
const deliveryId = "delivery123";
const artifactSha = "b".repeat(64);
const headBranch = `deployguard/remediation-${artifactSha.slice(0, 12)}`;
const headSha = "d".repeat(40);
const baseBranch = "main";
const baseSha = "a".repeat(40);
const secret = "test-only-secret";

function capability(now = Date.now()) {
  return issueGitHubPullRequestCapability(
    repository,
    deliveryId,
    artifactSha,
    headBranch,
    headSha,
    baseBranch,
    baseSha,
    now,
  );
}

function identity() {
  return {
    number: 42,
    state: "open",
    html_url: "https://github.com/owner/repo/pull/42",
    head: {
      ref: headBranch,
      sha: headSha,
      repo: { full_name: repository },
    },
    base: {
      ref: baseBranch,
      sha: baseSha,
      repo: { full_name: repository },
    },
  };
}

const expected = {
  repositoryIdentity: repository,
  baseBranch,
  baseSha,
  headBranch,
  headSha,
};

describe("GitHub PR capability security", () => {
  it("accepts a valid signed capability", () => {
    const issued = capability();
    const signed = signGitHubPullRequestCapability(issued, secret);

    expect(verifySignedGitHubPullRequestCapability(signed, secret)).toBe(true);

    expect(validateGitHubPullRequestCapability(
      issued, repository, deliveryId, artifactSha,
      headBranch, headSha, baseBranch, baseSha,
    )).toBe(true);
  });

  it("rejects a modified signed capability", () => {
    const signed = signGitHubPullRequestCapability(capability(), secret);

    signed.capability.headCommitSha = "e".repeat(40);

    expect(verifySignedGitHubPullRequestCapability(signed, secret)).toBe(false);
  });

  it("rejects a signature generated with another secret", () => {
    const signed = signGitHubPullRequestCapability(capability(), secret);

    expect(verifySignedGitHubPullRequestCapability(
      signed, "different-secret",
    )).toBe(false);
  });

  it("rejects an expired capability", () => {
    const now = Date.now();
    const issued = capability(now - 6 * 60_000);

    expect(validateGitHubPullRequestCapability(
      issued, repository, deliveryId, artifactSha,
      headBranch, headSha, baseBranch, baseSha, now,
    )).toBe(false);
  });

  it("rejects changed base branch authority", () => {
    const issued = capability();

    expect(validateGitHubPullRequestCapability(
      issued, repository, deliveryId, artifactSha,
      headBranch, headSha, baseBranch, "f".repeat(40),
    )).toBe(false);
  });

  it("rejects another repository", () => {
    const issued = capability();

    expect(validateGitHubPullRequestCapability(
      issued, "attacker/repo", deliveryId, artifactSha,
      headBranch, headSha, baseBranch, baseSha,
    )).toBe(false);
  });
});

describe("GitHub PR identity verification", () => {
  it("accepts the exact authorized PR", () => {
    expect(isVerifiedPullRequestIdentity(identity(), expected)).toBe(true);
  });

  it("rejects a PR from another repository", () => {
    const value = identity();
    value.head.repo.full_name = "attacker/repo";

    expect(isVerifiedPullRequestIdentity(value, expected)).toBe(false);
  });

  it("rejects a changed remediation commit", () => {
    const value = identity();
    value.head.sha = "f".repeat(40);

    expect(isVerifiedPullRequestIdentity(value, expected)).toBe(false);
  });

  it("rejects a changed base commit", () => {
    const value = identity();
    value.base.sha = "f".repeat(40);

    expect(isVerifiedPullRequestIdentity(value, expected)).toBe(false);
  });

  it("rejects a forged PR URL", () => {
    const value = identity();
    value.html_url = "https://example.com/fake-pr";

    expect(isVerifiedPullRequestIdentity(value, expected)).toBe(false);
  });

  it("rejects an invalid PR number", () => {
    const value = identity();
    value.number = -1;

    expect(isVerifiedPullRequestIdentity(value, expected)).toBe(false);
  });
});
