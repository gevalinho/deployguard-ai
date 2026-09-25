import {
  createHash,
} from "node:crypto";

import {
  runCommand,
} from "@/lib/execution/command-runner";

import {
  validateGitCommitCapability,
  verifySignedGitCommitCapability,
  type SignedGitCommitCapability,
} from "@/lib/remediation/git-commit-capability";

export interface GitCommitExecutionResult {
  status:
    | "committed"
    | "denied"
    | "verification_failed"
    | "commit_failed";

  artifactSha256: string;

  originalHead?: string;
  branchName?: string;

  preparedDiffSha256?: string;
  commitSha?: string;

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

function calculateSha256(
  content: string
): string {
  return createHash("sha256")
    .update(content)
    .digest("hex");
}

export async function executeVerifiedGitCommit(
  repositoryPath: string,
  signedCapability:
    SignedGitCommitCapability,
  signingSecret: string
): Promise<GitCommitExecutionResult> {
  const capability =
    signedCapability.capability;

  /*
   * First prove that this authorization was
   * actually issued by DeployGuard.
   */
  if (
    !verifySignedGitCommitCapability(
      signedCapability,
      signingSecret
    )
  ) {
    return {
      status: "denied",

      artifactSha256:
        capability.artifactSha256,

      summary:
        "Git commit capability signature verification failed.",
    };
  }

  /*
   * Independently observe the current branch.
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
    return {
      status:
        "verification_failed",

      artifactSha256:
        capability.artifactSha256,

      summary:
        "Unable to determine the current Git branch.",
    };
  }

  const branchName =
    branchResult.stdout.trim();

  /*
   * HEAD must still be the exact original
   * commit from which remediation was prepared.
   *
   * No commit is allowed if repository history
   * changed after authorization.
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
    return {
      status:
        "verification_failed",

      artifactSha256:
        capability.artifactSha256,

      branchName,

      summary:
        "Unable to determine the current Git HEAD.",
    };
  }

  const currentHead =
    headResult.stdout.trim();

  /*
   * Reconstruct the exact prepared repository
   * state immediately before commit authority
   * is exercised.
   */
  const diffResult =
    await runGit(
      repositoryPath,
      [
        "diff",
        "--binary",
        "HEAD",
      ]
    );

  if (
    diffResult.status !== "passed" ||
    !diffResult.stdout
  ) {
    return {
      status:
        "verification_failed",

      artifactSha256:
        capability.artifactSha256,

      originalHead:
        currentHead,

      branchName,

      summary:
        "Unable to verify the prepared remediation state before commit.",
    };
  }

  const preparedDiffSha256 =
    calculateSha256(
      diffResult.stdout
    );

  /*
   * Authorization is valid only for this exact:
   *
   * artifact
   * + original HEAD
   * + remediation branch
   * + prepared repository state
   * + validity window.
   */
  if (
    !validateGitCommitCapability(
      capability,
      capability.artifactSha256,
      currentHead,
      branchName,
      preparedDiffSha256
    )
  ) {
    return {
      status: "denied",

      artifactSha256:
        capability.artifactSha256,

      originalHead:
        currentHead,

      branchName,
      preparedDiffSha256,

      summary:
        "Git commit capability does not authorize the current remediation state.",
    };
  }

  /*
   * Stage only after authorization succeeds.
   */
  const addResult =
    await runGit(
      repositoryPath,
      [
        "add",
        "--all",
      ]
    );

  if (
    addResult.status !== "passed"
  ) {
    return {
      status:
        "verification_failed",

      artifactSha256:
        capability.artifactSha256,

      originalHead:
        currentHead,

      branchName,
      preparedDiffSha256,

      summary:
        "Unable to stage the authorized remediation state.",
    };
  }

  /*
   * Independently verify that staging did not
   * alter the authorized repository content.
   *
   * git diff --cached now represents exactly
   * what would enter the commit.
   */
  const stagedDiffResult =
    await runGit(
      repositoryPath,
      [
        "diff",
        "--cached",
        "--binary",
        "HEAD",
      ]
    );

  if (
    stagedDiffResult.status !== "passed" ||
    !stagedDiffResult.stdout
  ) {
    return {
      status:
        "verification_failed",

      artifactSha256:
        capability.artifactSha256,

      originalHead:
        currentHead,

      branchName,
      preparedDiffSha256,

      summary:
        "Unable to verify the staged remediation state.",
    };
  }

  const stagedDiffSha256 =
    calculateSha256(
      stagedDiffResult.stdout
    );

  if (
    stagedDiffSha256 !==
    preparedDiffSha256
  ) {
    return {
      status:
        "verification_failed",

      artifactSha256:
        capability.artifactSha256,

      originalHead:
        currentHead,

      branchName,
      preparedDiffSha256,

      summary:
        "Staged remediation state differs from the authorized prepared state.",
    };
  }

  /*
   * The exact staged state has now been:
   *
   * observed
   * hashed
   * authorized
   * staged
   * independently re-hashed
   *
   * Only now may DeployGuard create a commit.
   */
  const commitResult =
    await runGit(
      repositoryPath,
      [
        "commit",
        "-m",
        `fix: apply verified DeployGuard remediation ${capability.artifactSha256.slice(
          0,
          12
        )}`,
      ]
    );

  if (
    commitResult.status !== "passed"
  ) {
    return {
      status:
        "commit_failed",

      artifactSha256:
        capability.artifactSha256,

      originalHead:
        currentHead,

      branchName,
      preparedDiffSha256,

      summary:
        "Git failed to create the verified remediation commit.",
    };
  }

  /*
   * Capture the resulting immutable commit
   * identity.
   */
  const commitHeadResult =
    await runGit(
      repositoryPath,
      [
        "rev-parse",
        "HEAD",
      ]
    );

  if (
    commitHeadResult.status !== "passed"
  ) {
    return {
      status:
        "verification_failed",

      artifactSha256:
        capability.artifactSha256,

      originalHead:
        currentHead,

      branchName,
      preparedDiffSha256,

      summary:
        "Unable to identify the resulting remediation commit.",
    };
  }

  const commitSha =
    commitHeadResult.stdout.trim();

  /*
   * Independently prove that the commit was
   * created directly on top of the authorized
   * original HEAD.
   */
  const parentResult =
    await runGit(
      repositoryPath,
      [
        "rev-parse",
        "HEAD^",
      ]
    );

  if (
    parentResult.status !== "passed" ||
    parentResult.stdout.trim() !==
      currentHead
  ) {
    return {
      status:
        "verification_failed",

      artifactSha256:
        capability.artifactSha256,

      originalHead:
        currentHead,

      branchName,
      preparedDiffSha256,
      commitSha,

      summary:
        "Remediation commit parent does not match the authorized original HEAD.",
    };
  }

  return {
    status: "committed",

    artifactSha256:
      capability.artifactSha256,

    originalHead:
      currentHead,

    branchName,
    preparedDiffSha256,
    commitSha,

    summary:
      "Verified remediation state was committed after signed authorization and independent Git verification.",
  };
}