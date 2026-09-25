import {
  createHash,
} from "node:crypto";

import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  runCommand,
} from "@/lib/execution/command-runner";

import {
  issueArtifactAccessCapability,
} from "@/lib/remediation/artifact-access-capability";

import {
  signArtifactAccessCapability,
} from "@/lib/remediation/artifact-capability-signing";

import {
  issueGitCommitCapability,
  signGitCommitCapability,
} from "@/lib/remediation/git-commit-capability";

import {
  executeVerifiedGitCommit,
} from "@/lib/remediation/git-commit-executor";

import {
  prepareVerifiedGitDelivery,
} from "@/lib/remediation/git-delivery";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

const signingSecret =
  "deployguard-test-signing-secret";

const repositoryPath =
  mkdtempSync(
    join(
      tmpdir(),
      "deployguard-git-commit-"
    )
  );

async function git(
  args: string[]
) {
  return runCommand(
    "git",
    args,
    repositoryPath,
    {
      timeoutMs: 10_000,

      env: {
        ...process.env,

        GIT_TERMINAL_PROMPT:
          "0",
      },
    }
  );
}

async function requireGit(
  args: string[],
  operation: string
) {
  const result =
    await git(args);

  if (
    result.status !== "passed"
  ) {
    throw new Error(
      `${operation} failed: ${result.stderr}`
    );
  }

  return result;
}

async function main() {
  try {
    /*
     * Build an isolated disposable Git
     * repository.
     *
     * Do not use:
     *
     * git init -b main
     *
     * because the Git version used by this
     * environment does not support that flag.
     */
    await requireGit(
      [
        "init",
      ],
      "Git initialization"
    );

    await requireGit(
      [
        "config",
        "user.name",
        "DeployGuard Test",
      ],
      "Git user configuration"
    );

    await requireGit(
      [
        "config",
        "user.email",
        "deployguard@example.test",
      ],
      "Git email configuration"
    );

    const sourcePath =
      join(
        repositoryPath,
        "example.js"
      );

    writeFileSync(
      sourcePath,
      'const message = "old";\n',
      "utf8"
    );

    await requireGit(
      [
        "add",
        "example.js",
      ],
      "Initial staging"
    );

    await requireGit(
      [
        "commit",
        "-m",
        "initial fixture",
      ],
      "Initial commit"
    );

    await requireGit(
      [
        "branch",
        "-M",
        "main",
      ],
      "Main branch creation"
    );

    const originalHeadResult =
      await requireGit(
        [
          "rev-parse",
          "HEAD",
        ],
        "Original HEAD lookup"
      );

    const originalHead =
      originalHeadResult.stdout.trim();

    /*
     * Build the verified artifact that will
     * travel through the complete trusted
     * delivery boundary.
     */
    const content =
      `diff --git a/example.js b/example.js
--- a/example.js
+++ b/example.js
@@ -1 +1 @@
-const message = "old";
+const message = "new";
`;

    const artifactSha256 =
      createHash("sha256")
        .update(content)
        .digest("hex");

    const artifact:
      VerifiedPatchArtifact = {
        format:
          "unified_diff",

        content,

        sha256:
          artifactSha256,

        byteSize:
          Buffer.byteLength(
            content,
            "utf8"
          ),
      };

    /*
     * Authorize Git delivery of the exact
     * verified artifact.
     */
    const artifactCapability =
      signArtifactAccessCapability(
        issueArtifactAccessCapability(
          "github_integration",
          artifact.sha256
        ),
        signingSecret
      );

    const delivery =
      await prepareVerifiedGitDelivery(
        repositoryPath,
        artifact,
        artifactCapability,
        signingSecret
      );

    if (
      delivery.status !== "prepared" ||
      !delivery.originalHead ||
      !delivery.branchName ||
      !delivery.preparedDiffSha256
    ) {
      throw new Error(
        `Git delivery preparation failed: ${delivery.summary}`
      );
    }

    console.log(
      "✓ Verified remediation prepared for commit."
    );

    /*
     * The prepared state itself becomes part of
     * commit authority.
     */
    const commitCapability =
      issueGitCommitCapability(
        artifact.sha256,
        delivery.originalHead,
        delivery.branchName,
        delivery.preparedDiffSha256
      );

    const signedCommitCapability =
      signGitCommitCapability(
        commitCapability,
        signingSecret
      );

    /*
     * Execute the actual commit through the
     * authorization boundary.
     */
    const commitResult =
      await executeVerifiedGitCommit(
        repositoryPath,
        signedCommitCapability,
        signingSecret
      );

    if (
      commitResult.status !==
      "committed"
    ) {
      throw new Error(
        `Verified Git commit failed: ${commitResult.summary}`
      );
    }

    if (
      !commitResult.commitSha
    ) {
      throw new Error(
        "Commit executor did not return a commit SHA."
      );
    }

    console.log(
      "✓ Signed commit authorization accepted."
    );

    console.log(
      "✓ Verified remediation committed."
    );

    /*
     * The resulting file must contain exactly
     * the authorized remediation.
     */
    const sourceAfter =
      readFileSync(
        sourcePath,
        "utf8"
      );

    if (
      sourceAfter !==
      'const message = "new";\n'
    ) {
      throw new Error(
        "Committed repository content differs from the verified remediation."
      );
    }

    console.log(
      "✓ Exact remediation content committed."
    );

    /*
     * HEAD must now equal the commit identity
     * returned by the executor.
     */
    const headAfterResult =
      await requireGit(
        [
          "rev-parse",
          "HEAD",
        ],
        "Committed HEAD lookup"
      );

    const headAfter =
      headAfterResult.stdout.trim();

    if (
      headAfter !==
      commitResult.commitSha
    ) {
      throw new Error(
        "Executor commit SHA does not match Git HEAD."
      );
    }

    if (
      headAfter ===
      originalHead
    ) {
      throw new Error(
        "Commit executor did not create a new Git commit."
      );
    }

    console.log(
      "✓ New immutable commit SHA produced."
    );

    /*
     * The new commit must sit directly on the
     * original authorized HEAD.
     */
    const parentResult =
      await requireGit(
        [
          "rev-parse",
          "HEAD^",
        ],
        "Commit parent lookup"
      );

    if (
      parentResult.stdout.trim() !==
      originalHead
    ) {
      throw new Error(
        "Verified remediation commit has an unexpected parent."
      );
    }

    console.log(
      "✓ Original HEAD preserved as commit parent."
    );

    /*
     * Main must still reference the original
     * untouched commit.
     */
    const mainResult =
      await requireGit(
        [
          "rev-parse",
          "main",
        ],
        "Main branch verification"
      );

    if (
      mainResult.stdout.trim() !==
      originalHead
    ) {
      throw new Error(
        "Main branch was modified by the remediation commit."
      );
    }

    console.log(
      "✓ Main branch remained untouched."
    );

    /*
     * A successful commit should consume all
     * prepared working-tree changes.
     */
    const statusResult =
      await requireGit(
        [
          "status",
          "--porcelain",
        ],
        "Final workspace verification"
      );

    if (
      statusResult.stdout.trim()
    ) {
      throw new Error(
        "Repository remained dirty after the verified commit."
      );
    }

    console.log(
      "✓ Working tree clean after commit."
    );

    /*
     * This test deliberately configures no
     * remote and performs no push.
     */
    const remoteResult =
      await requireGit(
        [
          "remote",
        ],
        "Remote verification"
      );

    if (
      remoteResult.stdout.trim()
    ) {
      throw new Error(
        "Disposable commit test unexpectedly contains a Git remote."
      );
    }

    console.log(
      "✓ No Git push boundary crossed."
    );

    console.log(
      "\n✓ Verified Git Commit execution succeeded."
    );
  } finally {
    rmSync(
      repositoryPath,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

void main();