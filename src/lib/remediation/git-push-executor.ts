import { createRemediationBranchName } from "@/lib/remediation/git-delivery";
import {
  runCommand,
} from "@/lib/execution/command-runner";

import {
  validateGitPushCapability,
  verifySignedGitPushCapability,
  type SignedGitPushCapability,
} from "@/lib/remediation/git-push-capability";

/** Trusted process-local transport; opened only after capability and Git checks. */
export interface GitPushTransport {
  remote: string;
  run(args: string[]): Promise<{ status: "passed" | "failed"; stdout: string }>;
  dispose(): Promise<void>;
}

export type GitPushTransportFactory = (scope: {
  repositoryPath: string;
  repositoryIdentity: string;
  remoteUrl: string;
}) => Promise<GitPushTransport>;

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
  signingSecret: string,
  openTransport?: GitPushTransportFactory
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
    (openTransport && capability.branchName !== createRemediationBranchName(artifactSha256)) ||
    !/^[a-f0-9]{40}$/.test(capability.commitSha) ||
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

  let transport: GitPushTransport | undefined;
  let pushed = false;
  try {
    transport = await openTransport?.({
      repositoryPath,
      repositoryIdentity,
      remoteUrl: remoteResult.stdout.trim(),
    });
    // Token issuance may take time. Expired authority must never execute a push.
    if (!verifySignedGitPushCapability(signedCapability, signingSecret) ||
        !validateGitPushCapability(capability, repositoryIdentity,
          capability.remoteName, observedBranch, observedHead, artifactSha256)) {
      return createResult(signedCapability, "denied", "Git push authority expired before execution.");
    }
    const remote = transport?.remote ?? capability.remoteName;
    const execute = (args: string[]) => transport
      ? transport.run(args)
      : runGit(repositoryPath, args);
    const pushResult = await execute([
      "push", "--", remote,
      `${capability.commitSha}:refs/heads/${capability.branchName}`,
    ]);
    if (pushResult.status !== "passed") {
      return createResult(signedCapability, "push_failed", "Authorized verified Git push failed.");
    }
    pushed = true;
    const remoteHeadResult = await execute([
      "ls-remote", "--refs", "--", remote, `refs/heads/${capability.branchName}`,
    ]);
    const expected = `${capability.commitSha}\trefs/heads/${capability.branchName}`;
    if (remoteHeadResult.status !== "passed" || remoteHeadResult.stdout.trim() !== expected) {
      return createResult(signedCapability, "verification_failed",
        "Remote Git branch does not match the authorized commit after push.");
    }
    return createResult(signedCapability, "pushed",
      "Authorized verified remediation commit was pushed and independently verified.");
  } catch {
    // Neither transport exceptions nor Git output may escape this boundary.
    return createResult(signedCapability, pushed ? "verification_failed" : "push_failed",
      "Authenticated Git delivery failed.");
  } finally {
    await transport?.dispose().catch(() => undefined);
  }
}
