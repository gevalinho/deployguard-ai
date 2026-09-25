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
      "deployguard-git-delivery-"
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
  failureMessage: string
) {
  const result =
    await git(args);

  if (
    result.status !== "passed"
  ) {
    throw new Error(
      `${failureMessage}: ${result.stderr}`
    );
  }

  return result;
}

async function main() {
  try {
    /*
     * Build a completely disposable Git
     * repository.
     *
     * Do not use:
     *
     *   git init -b main
     *
     * because older Git versions do not support
     * the --initial-branch option.
     */
    await requireGit(
      [
        "init",
      ],
      "Unable to initialize test repository"
    );

    await requireGit(
      [
        "config",
        "user.name",
        "DeployGuard Test",
      ],
      "Unable to configure Git user name"
    );

    await requireGit(
      [
        "config",
        "user.email",
        "deployguard@example.test",
      ],
      "Unable to configure Git user email"
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
      "Unable to stage test fixture"
    );

    await requireGit(
      [
        "commit",
        "-m",
        "initial fixture",
      ],
      "Unable to create initial test commit"
    );

    /*
     * Normalize the initial branch name only
     * after the first commit.
     *
     * This works across older Git versions where
     * `git init -b main` is unavailable.
     */
    await requireGit(
      [
        "branch",
        "-M",
        "main",
      ],
      "Unable to normalize test branch to main"
    );

    const originalHeadResult =
      await requireGit(
        [
          "rev-parse",
          "HEAD",
        ],
        "Unable to determine original Git HEAD"
      );

    const originalHead =
      originalHeadResult.stdout.trim();

    /*
     * The delivery boundary requires a clean
     * repository before applying any artifact.
     */
    const statusBeforeDelivery =
      await requireGit(
        [
          "status",
          "--porcelain",
        ],
        "Unable to inspect test repository status"
      );

    if (
      statusBeforeDelivery.stdout.trim()
    ) {
      throw new Error(
        "Test repository was unexpectedly dirty before Git delivery."
      );
    }

    /*
     * Use a conventional unified diff as the
     * verified artifact presented to the Git
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

    const sha256 =
      createHash("sha256")
        .update(content)
        .digest("hex");

    const artifact:
      VerifiedPatchArtifact = {
        format:
          "unified_diff",

        content,

        sha256,

        byteSize:
          Buffer.byteLength(
            content,
            "utf8"
          ),
      };

    /*
     * Git delivery is a trusted consumer.
     *
     * Issue a capability scoped to:
     *
     *   - github_integration
     *   - this exact artifact SHA-256
     *
     * and cryptographically sign it before
     * presenting it to the delivery boundary.
     */
    const signedCapability =
      signArtifactAccessCapability(
        issueArtifactAccessCapability(
          "github_integration",
          artifact.sha256
        ),
        signingSecret
      );

    /*
     * Prepare the verified artifact for Git
     * delivery.
     */
    const result =
      await prepareVerifiedGitDelivery(
        repositoryPath,
        artifact,
        signedCapability,
        signingSecret
      );

    if (
      result.status !==
      "prepared"
    ) {
      throw new Error(
        `Git delivery was not prepared: ${result.summary}`
      );
    }

    /*
     * Independently verify that the artifact
     * produced the expected repository content.
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
        "Verified artifact produced unexpected repository content."
      );
    }

    console.log(
      "✓ Authorized verified artifact applied."
    );

    /*
     * Delivery must occur on an isolated
     * remediation branch.
     */
    const branchResult =
      await requireGit(
        [
          "branch",
          "--show-current",
        ],
        "Unable to determine remediation branch"
      );

    if (
      branchResult.stdout.trim() !==
      result.branchName
    ) {
      throw new Error(
        "Artifact was not applied on the expected remediation branch."
      );
    }

    console.log(
      "✓ Isolated remediation branch created."
    );

    /*
     * Applying an artifact must not rewrite the
     * original commit.
     *
     * No commit has been authorized at this
     * stage of the delivery pipeline.
     */
    const currentHeadResult =
      await requireGit(
        [
          "rev-parse",
          "HEAD",
        ],
        "Unable to determine delivery HEAD"
      );

    if (
      currentHeadResult.stdout.trim() !==
      originalHead
    ) {
      throw new Error(
        "Git delivery unexpectedly changed HEAD before commit authorization."
      );
    }

    console.log(
      "✓ Original Git HEAD preserved."
    );

    /*
     * Git must independently observe the file
     * modified by the verified artifact.
     */
    if (
      !result.changedFiles?.some(
        (file) =>
          file.includes(
            "example.js"
          )
      )
    ) {
      throw new Error(
        "Expected verified file change was not reported."
      );
    }

    console.log(
      "✓ Applied repository change independently observed."
    );

    /*
 * Delivery preparation must expose a
 * cryptographic identity for the exact Git
 * working-tree state prepared for commit.
 */
if (
  !result.preparedDiffSha256 ||
  !/^[a-f0-9]{64}$/.test(
    result.preparedDiffSha256
  )
) {
  throw new Error(
    "Git delivery did not produce a valid prepared-state SHA-256."
  );
}

const preparedDiffResult =
  await requireGit(
    [
      "diff",
      "--binary",
      "HEAD",
    ],
    "Unable to independently inspect prepared Git state"
  );

const independentlyCalculatedSha256 =
  createHash("sha256")
    .update(
      preparedDiffResult.stdout
    )
    .digest("hex");

if (
  independentlyCalculatedSha256 !==
  result.preparedDiffSha256
) {
  throw new Error(
    "Prepared Git state identity could not be independently reproduced."
  );
}

console.log(
  "✓ Prepared Git state cryptographically identified."
);




    /*
     * The protected main branch must still point
     * at the untouched original commit.
     */
    const mainHeadResult =
      await requireGit(
        [
          "rev-parse",
          "main",
        ],
        "Unable to determine main branch HEAD"
      );

    if (
      mainHeadResult.stdout.trim() !==
      originalHead
    ) {
      throw new Error(
        "Main branch was modified during delivery preparation."
      );
    }

    console.log(
      "✓ Main branch remained untouched."
    );

    console.log(
      "\n✓ Verified Git Delivery preparation succeeded."
    );
  } finally {
    /*
     * Always destroy the disposable repository,
     * regardless of test success or failure.
     */
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