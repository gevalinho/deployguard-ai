import {
  runCommand,
} from "@/lib/execution/command-runner";

import {
  validateGitPushCapability,
  verifySignedGitPushCapability,
  type SignedGitPushCapability,
} from "@/lib/remediation/git-push-capability";

export interface GitPushExecutionResult {
  status:
    | "pushed"
    | "denied"
    | "verification_failed"
    | "push_failed";

  repositoryIdentity: string;
  remoteName: string;
  branchName: string;
  commitSha: string;
  artifactSha256: string;

  summary: string;
}

const GIT_TIMEOUT_MS =
  30_000;

async function runGit(
  repositoryPath: string,
  args: string[]
) {
  return runCommand(
    "git",
    args,
    repositoryPath,
    {
      timeoutMs:
        GIT_TIMEOUT_MS,

      env: {
        ...process.env,

        GIT_TERMINAL_PROMPT:
          "0",
      },
    }
  );
}

function createResult(
  signedCapability:
    SignedGitPushCapability,
  status:
    GitPushExecutionResult["status"],
  summary: string
): GitPushExecutionResult {
  const capability =
    signedCapability.capability;

  return {
    status,

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

    summary,
  };
}

export async function executeVerifiedGitPush(
  repositoryPath: string,
  repositoryIdentity: string,
  artifactSha256: string,
  signedCapability:
    SignedGitPushCapability,
  signingSecret: string
): Promise<GitPushExecutionResult> {
  const capability =
    signedCapability.capability;

  /*
   * The signed capability must first prove
   * cryptographic authenticity.
   */
  if (
    !verifySignedGitPushCapability(
      signedCapability,
      signingSecret
    )
  ) {
    return createResult(
      signedCapability,
      "denied",
      "Git push capability signature verification failed."
    );
  }

  /*
   * Independently observe the currently checked
   * out branch.
   */
  const branchResult =
    await runGit(
      repositoryPath,
      [
        "branch",
        "--show-current",
      ]
    );

  if (
    branchResult.status !== "passed"
  ) {
    return createResult(
      signedCapability,
      "verification_failed",
      "Unable to determine the current Git branch."
    );
  }

  const observedBranch =
    branchResult.stdout.trim();

  /*
   * Independently observe the repository HEAD.
   */
  const headResult =
    await runGit(
      repositoryPath,
      [
        "rev-parse",
        "HEAD",
      ]
    );

  if (
    headResult.status !== "passed"
  ) {
    return createResult(
      signedCapability,
      "verification_failed",
      "Unable to determine the current Git HEAD."
    );
  }

  const observedHead =
    headResult.stdout.trim();

  /*
   * Ensure the authorized remote actually exists
   * in this repository before attempting push.
   */
  const remoteResult =
    await runGit(
      repositoryPath,
      [
        "remote",
        "get-url",
        capability.remoteName,
      ]
    );

  if (
    remoteResult.status !== "passed" ||
    !remoteResult.stdout.trim()
  ) {
    return createResult(
      signedCapability,
      "verification_failed",
      "Authorized Git remote could not be resolved."
    );
  }

  /*
   * Validate the complete capability scope
   * against independently observed repository
   * state and caller-supplied immutable identity.
   *
   * This also enforces capability expiry.
   */
  if (
    !validateGitPushCapability(
      capability,
      repositoryIdentity,
      capability.remoteName,
      observedBranch,
      observedHead,
      artifactSha256
    )
  ) {
    return createResult(
      signedCapability,
      "denied",
      "Git push capability does not authorize the current repository state."
    );
  }

  /*
   * Require a clean working tree before crossing
   * the push boundary.
   *
   * The pushed commit is immutable, but refusing
   * dirty state keeps the delivery boundary
   * deterministic and auditable.
   */
  const statusResult =
    await runGit(
      repositoryPath,
      [
        "status",
        "--porcelain",
      ]
    );

  if (
    statusResult.status !== "passed" ||
    statusResult.stdout.trim()
  ) {
    return createResult(
      signedCapability,
      "verification_failed",
      "Git push requires a clean repository workspace."
    );
  }

  /*
   * Push the exact immutable commit SHA to the
   * exact authorized branch on the exact
   * authorized remote.
   *
   * Do not rely on implicit upstream state.
   */
  const pushResult =
    await runGit(
      repositoryPath,
      [
        "push",

        capability.remoteName,

        `${capability.commitSha}:refs/heads/${capability.branchName}`,
      ]
    );

  if (
    pushResult.status !== "passed"
  ) {
    return createResult(
      signedCapability,
      "push_failed",
      "Authorized verified Git push failed."
    );
  }

  /*
   * Independently verify that the remote branch
   * now resolves to the exact authorized commit.
   */
  const remoteHeadResult =
    await runGit(
      repositoryPath,
      [
        "ls-remote",
        capability.remoteName,
        `refs/heads/${capability.branchName}`,
      ]
    );

  if (
    remoteHeadResult.status !== "passed"
  ) {
    return createResult(
      signedCapability,
      "verification_failed",
      "Unable to verify the remote Git branch after push."
    );
  }

  const remoteHead =
    remoteHeadResult.stdout
      .trim()
      .split(/\s+/)[0];

  if (
    remoteHead !==
    capability.commitSha
  ) {
    return createResult(
      signedCapability,
      "verification_failed",
      "Remote Git branch does not match the authorized commit after push."
    );
  }

  return createResult(
    signedCapability,
    "pushed",
    "Authorized verified remediation commit was pushed and independently verified."
  );
}