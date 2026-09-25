import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  createHash,
} from "node:crypto";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  runCommand,
} from "@/lib/execution/command-runner";

import type {
  SignedArtifactAccessCapability,
} from "@/lib/remediation/artifact-capability-signing";

import {
  consumeVerifiedArtifact,
} from "@/lib/remediation/trusted-artifact-consumer";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

export interface GitDeliveryResult {
  status:
    | "prepared"
    | "denied"
    | "apply_failed"
    | "verification_failed";

  branchName?: string;

  originalHead?: string;

  deliveryHead?: string;

  changedFiles?: string[];

  preparedDiffSha256?: string;

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

function createBranchName(
  artifactSha256: string
): string {
  return (
    "deployguard/remediation-" +
    artifactSha256.slice(0, 12)
  );
}

export async function prepareVerifiedGitDelivery(
  repositoryPath: string,
  artifact: VerifiedPatchArtifact,
  signedCapability:
    SignedArtifactAccessCapability,
  signingSecret: string
): Promise<GitDeliveryResult> {
  /*
   * Git delivery is a trusted artifact consumer.
   *
   * It must never operate on artifact content
   * before authorization and independent
   * integrity verification succeed.
   */
  const consumed =
    consumeVerifiedArtifact(
      artifact,
      "github_integration",
      signedCapability,
      signingSecret
    );

  if (
    consumed.status !== "consumed" ||
    consumed.content === undefined
  ) {
    return {
      status: "denied",

      artifactSha256:
        artifact.sha256,

      summary:
        "Verified artifact was not authorized for Git delivery.",
    };
  }

  
  /*
   * Never begin delivery from a dirty repository.
   *
   * This prevents DeployGuard from accidentally
   * including unrelated developer changes.
   */
  const statusBefore =
    await runGit(
      repositoryPath,
      [
        "status",
        "--porcelain",
      ]
    );

    if (
    statusBefore.status !== "passed" ||
    statusBefore.stdout.trim()
  ) {
    return {
      status:
        "verification_failed",

      artifactSha256:
        artifact.sha256,

      summary:
        "Git delivery requires a clean repository workspace.",
    };
  }

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
        artifact.sha256,

      summary:
        "Unable to determine the original Git HEAD.",
    };
  }

  const originalHead =
    headResult.stdout.trim();

  const branchName =
    createBranchName(
      artifact.sha256
    );

  const branchResult =
    await runGit(
      repositoryPath,
      [
        "switch",
        "-c",
        branchName,
      ]
    );

  if (
    branchResult.status !== "passed"
  ) {
    return {
      status:
        "verification_failed",

      artifactSha256:
        artifact.sha256,

      originalHead,

      summary:
        "Unable to create the isolated DeployGuard remediation branch.",
    };
  }

  /*
   * Artifact content is written only to a
   * temporary file outside the repository.
   *
   * This avoids the patch itself appearing as
   * an untracked repository file.
   */
  const patchDirectory =
    mkdtempSync(
      join(
        tmpdir(),
        "deployguard-patch-"
      )
    );

  const patchPath =
    join(
      patchDirectory,
      "verified.patch"
    );

  try {
    writeFileSync(
      patchPath,
      consumed.content,
      "utf8"
    );

    /*
     * First ask Git whether the artifact can be
     * applied cleanly.
     *
     * The actual repository is not mutated until
     * this deterministic check succeeds.
     */
    const checkResult =
      await runGit(
        repositoryPath,
        [
          "apply",
          "--check",
          patchPath,
        ]
      );

    if (
      checkResult.status !== "passed"
    ) {
      await runGit(
        repositoryPath,
        [
          "switch",
          "-",
        ]
      );

      await runGit(
        repositoryPath,
        [
          "branch",
          "-D",
          branchName,
        ]
      );
      

      return {
        status:
          "apply_failed",

        artifactSha256:
          artifact.sha256,

        originalHead,

        summary:
          "Verified artifact failed Git apply validation.",
      };
    }

    const applyResult =
      await runGit(
        repositoryPath,
        [
          "apply",
          patchPath,
        ]
      );

    if (
      applyResult.status !== "passed"
    ) {
      await runGit(
        repositoryPath,
        [
          "reset",
          "--hard",
          originalHead,
        ]
      );

      await runGit(
        repositoryPath,
        [
          "switch",
          "-",
        ]
      );

      await runGit(
        repositoryPath,
        [
          "branch",
          "-D",
          branchName,
        ]
      );

      return {
        status:
          "apply_failed",

        artifactSha256:
          artifact.sha256,

        originalHead,

        summary:
          "Verified artifact could not be applied to the delivery workspace.",
      };
    }

    /*
     * Capture the actual files Git reports as
     * changed after applying the verified
     * artifact.
     */
    const changedResult =
      await runGit(
        repositoryPath,
        [
          "status",
          "--porcelain",
        ]
      );

    if (
      changedResult.status !== "passed"
    ) {
      return {
        status:
          "verification_failed",

        artifactSha256:
          artifact.sha256,

        originalHead,
        branchName,

        summary:
          "Unable to verify Git changes after artifact application.",
      };
    }

    const changedFiles =
      changedResult.stdout
        .split(/\r?\n/)
        .map(
          (line) =>
            line.trim()
        )
        .filter(Boolean);

    if (
      changedFiles.length === 0
    ) {
      return {
        status:
          "verification_failed",

        artifactSha256:
          artifact.sha256,

        originalHead,
        branchName,

        summary:
          "Artifact application produced no Git changes.",
      };
    }


    /*
 * Cryptographically identify the exact
 * repository state prepared for commit.
 *
 * Commit authorization alone is insufficient:
 * the working tree could be modified between
 * artifact application and commit execution.
 *
 * The prepared diff identity allows the commit
 * boundary to independently detect such drift.
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
  diffResult.status !== "passed"
) {
  return {
    status:
      "verification_failed",

    artifactSha256:
      artifact.sha256,

    originalHead,
    branchName,

    summary:
      "Unable to capture the prepared Git remediation state.",
  };
}

if (
  !diffResult.stdout
) {
  return {
    status:
      "verification_failed",

    artifactSha256:
      artifact.sha256,

    originalHead,
    branchName,

    summary:
      "Prepared Git remediation state produced no diff.",
  };
}

const preparedDiffSha256 =
  createHash("sha256")
    .update(
      diffResult.stdout
    )
    .digest("hex");



    return {
  status: "prepared",

  artifactSha256:
    artifact.sha256,

  originalHead,
  branchName,
  changedFiles,

  preparedDiffSha256,

  summary:
    "Verified artifact was safely applied to an isolated remediation branch.",
};
  } finally {
    rmSync(
      patchDirectory,
      {
        recursive: true,
        force: true,
      }
    );
  }
}