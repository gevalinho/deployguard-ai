import {
  createHash,
} from "node:crypto";

import {
  mkdtempSync,
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
  type GitDeliveryResult,
} from "@/lib/remediation/git-delivery";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

const signingSecret =
  "deployguard-test-signing-secret";

interface PreparedFixture {
  repositoryPath: string;
  artifact: VerifiedPatchArtifact;
  delivery: GitDeliveryResult;
}

async function git(
  repositoryPath: string,
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
  repositoryPath: string,
  args: string[],
  operation: string
) {
  const result =
    await git(
      repositoryPath,
      args
    );

  if (
    result.status !== "passed"
  ) {
    throw new Error(
      `${operation} failed: ${result.stderr}`
    );
  }

  return result;
}

async function createPreparedFixture():
Promise<PreparedFixture> {
  const repositoryPath =
    mkdtempSync(
      join(
        tmpdir(),
        "deployguard-git-adversarial-"
      )
    );

  try {
    /*
     * Build an isolated disposable repository.
     *
     * Do not use git init -b because the Git
     * version in this environment does not
     * support that option.
     */
    await requireGit(
      repositoryPath,
      [
        "init",
      ],
      "Git initialization"
    );

    await requireGit(
      repositoryPath,
      [
        "config",
        "user.name",
        "DeployGuard Test",
      ],
      "Git user configuration"
    );

    await requireGit(
      repositoryPath,
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
      repositoryPath,
      [
        "add",
        "example.js",
      ],
      "Initial staging"
    );

    await requireGit(
      repositoryPath,
      [
        "commit",
        "-m",
        "initial fixture",
      ],
      "Initial commit"
    );

    await requireGit(
      repositoryPath,
      [
        "branch",
        "-M",
        "main",
      ],
      "Main branch creation"
    );

    /*
     * Construct the exact verified artifact.
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
     * Authorize Git delivery.
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
        `Unable to prepare adversarial fixture: ${delivery.summary}`
      );
    }

    return {
      repositoryPath,
      artifact,
      delivery,
    };
  } catch (error) {
    rmSync(
      repositoryPath,
      {
        recursive: true,
        force: true,
      }
    );

    throw error;
  }
}

function createSignedCommitCapability(
  fixture: PreparedFixture,
  now = Date.now()
) {
  const {
    artifact,
    delivery,
  } = fixture;

  if (
    !delivery.originalHead ||
    !delivery.branchName ||
    !delivery.preparedDiffSha256
  ) {
    throw new Error(
      "Prepared fixture is missing commit authorization state."
    );
  }

  return signGitCommitCapability(
    issueGitCommitCapability(
      artifact.sha256,
      delivery.originalHead,
      delivery.branchName,
      delivery.preparedDiffSha256,
      now
    ),
    signingSecret
  );
}

async function assertHeadUnchanged(
  fixture: PreparedFixture,
  expectedHead: string
) {
  const result =
    await requireGit(
      fixture.repositoryPath,
      [
        "rev-parse",
        "HEAD",
      ],
      "HEAD verification"
    );

  if (
    result.stdout.trim() !==
    expectedHead
  ) {
    throw new Error(
      "Rejected commit attempt unexpectedly changed HEAD."
    );
  }
}

/*
 * ------------------------------------------------
 * 1. Wrong signing secret
 * ------------------------------------------------
 */

async function testWrongSigningSecret() {
  const fixture =
    await createPreparedFixture();

  try {
    const capability =
      createSignedCommitCapability(
        fixture
      );

    const headBefore =
      (
        await requireGit(
          fixture.repositoryPath,
          [
            "rev-parse",
            "HEAD",
          ],
          "HEAD lookup"
        )
      ).stdout.trim();

    const result =
      await executeVerifiedGitCommit(
        fixture.repositoryPath,
        capability,
        "wrong-signing-secret"
      );

    if (
      result.status !== "denied"
    ) {
      throw new Error(
        "Wrong signing secret unexpectedly authorized a commit."
      );
    }

    await assertHeadUnchanged(
      fixture,
      headBefore
    );

    console.log(
      "✓ Wrong signing secret rejected by commit executor."
    );
  } finally {
    rmSync(
      fixture.repositoryPath,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

/*
 * ------------------------------------------------
 * 2. Expired authorization
 * ------------------------------------------------
 */

async function testExpiredAuthorization() {
  const fixture =
    await createPreparedFixture();

  try {
    /*
     * Capabilities live for five minutes.
     * Issue this one ten minutes in the past.
     */
    const capability =
      createSignedCommitCapability(
        fixture,
        Date.now() -
          10 * 60 * 1000
      );

    const headBefore =
      (
        await requireGit(
          fixture.repositoryPath,
          [
            "rev-parse",
            "HEAD",
          ],
          "HEAD lookup"
        )
      ).stdout.trim();

    const result =
      await executeVerifiedGitCommit(
        fixture.repositoryPath,
        capability,
        signingSecret
      );

    if (
      result.status !== "denied"
    ) {
      throw new Error(
        "Expired authorization unexpectedly created a commit."
      );
    }

    await assertHeadUnchanged(
      fixture,
      headBefore
    );

    console.log(
      "✓ Expired authorization rejected by commit executor."
    );
  } finally {
    rmSync(
      fixture.repositoryPath,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

/*
 * ------------------------------------------------
 * 3. Branch drift
 * ------------------------------------------------
 */

async function testBranchDrift() {
  const fixture =
    await createPreparedFixture();

  try {
    const capability =
      createSignedCommitCapability(
        fixture
      );

    const headBefore =
      (
        await requireGit(
          fixture.repositoryPath,
          [
            "rev-parse",
            "HEAD",
          ],
          "HEAD lookup"
        )
      ).stdout.trim();

    /*
     * Preserve the prepared working tree while
     * changing only the current branch identity.
     */
    await requireGit(
      fixture.repositoryPath,
      [
        "switch",
        "-c",
        "attacker-branch",
      ],
      "Adversarial branch switch"
    );

    const result =
      await executeVerifiedGitCommit(
        fixture.repositoryPath,
        capability,
        signingSecret
      );

    if (
      result.status !== "denied"
    ) {
      throw new Error(
        "Branch drift unexpectedly authorized a commit."
      );
    }

    await assertHeadUnchanged(
      fixture,
      headBefore
    );

    console.log(
      "✓ Branch drift rejected by commit executor."
    );
  } finally {
    rmSync(
      fixture.repositoryPath,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

/*
 * ------------------------------------------------
 * 4. HEAD drift
 * ------------------------------------------------
 */

async function testHeadDrift() {
  const fixture =
    await createPreparedFixture();

  try {
    const capability =
      createSignedCommitCapability(
        fixture
      );

    /*
     * Temporarily remove the prepared change,
     * create an unrelated commit, then restore
     * the prepared source mutation.
     *
     * The working content may look legitimate,
     * but HEAD is no longer the authorized HEAD.
     */
    await requireGit(
      fixture.repositoryPath,
      [
        "reset",
        "--hard",
        "HEAD",
      ],
      "Working tree reset"
    );

    writeFileSync(
      join(
        fixture.repositoryPath,
        "unrelated.txt"
      ),
      "unexpected history change\n",
      "utf8"
    );

    await requireGit(
      fixture.repositoryPath,
      [
        "add",
        "unrelated.txt",
      ],
      "Adversarial staging"
    );

    await requireGit(
      fixture.repositoryPath,
      [
        "commit",
        "-m",
        "adversarial history change",
      ],
      "Adversarial commit"
    );

    const driftedHead =
      (
        await requireGit(
          fixture.repositoryPath,
          [
            "rev-parse",
            "HEAD",
          ],
          "Drifted HEAD lookup"
        )
      ).stdout.trim();

    writeFileSync(
      join(
        fixture.repositoryPath,
        "example.js"
      ),
      'const message = "new";\n',
      "utf8"
    );

    const result =
      await executeVerifiedGitCommit(
        fixture.repositoryPath,
        capability,
        signingSecret
      );

    if (
      result.status !== "denied"
    ) {
      throw new Error(
        "HEAD drift unexpectedly authorized the remediation commit."
      );
    }

    await assertHeadUnchanged(
      fixture,
      driftedHead
    );

    console.log(
      "✓ HEAD drift rejected by commit executor."
    );
  } finally {
    rmSync(
      fixture.repositoryPath,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

/*
 * ------------------------------------------------
 * 5. Working-tree drift
 * ------------------------------------------------
 */

async function testWorkingTreeDrift() {
  const fixture =
    await createPreparedFixture();

  try {
    const capability =
      createSignedCommitCapability(
        fixture
      );

    const headBefore =
      (
        await requireGit(
          fixture.repositoryPath,
          [
            "rev-parse",
            "HEAD",
          ],
          "HEAD lookup"
        )
      ).stdout.trim();

    /*
     * Add content that was never part of the
     * prepared remediation state.
     */
    writeFileSync(
      join(
        fixture.repositoryPath,
        "attacker.txt"
      ),
      "unauthorized mutation\n",
      "utf8"
    );

    const result =
      await executeVerifiedGitCommit(
        fixture.repositoryPath,
        capability,
        signingSecret
      );


      if (
  result.status !==
  "verification_failed"
) {
  throw new Error(
    `Working-tree drift was not rejected during verification: ${result.status}`
  );
}

    await assertHeadUnchanged(
      fixture,
      headBefore
    );

    console.log(
      "✓ Working-tree drift rejected by commit executor."
    );
  } finally {
    rmSync(
      fixture.repositoryPath,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

/*
 * ------------------------------------------------
 * 6. Untouched authorized state
 * ------------------------------------------------
 */

async function testValidCommit() {
  const fixture =
    await createPreparedFixture();

  try {
    const capability =
      createSignedCommitCapability(
        fixture
      );

    const result =
      await executeVerifiedGitCommit(
        fixture.repositoryPath,
        capability,
        signingSecret
      );

    if (
      result.status !== "committed" ||
      !result.commitSha
    ) {
      throw new Error(
        `Valid prepared state was not committed: ${result.summary}`
      );
    }

    const source =
      await requireGit(
        fixture.repositoryPath,
        [
          "show",
          "HEAD:example.js",
        ],
        "Committed content verification"
      );

    if (
      source.stdout !==
      'const message = "new";\n'
    ) {
      throw new Error(
        "Valid commit contains unexpected remediation content."
      );
    }

    console.log(
      "✓ Untouched authorized remediation committed successfully."
    );
  } finally {
    rmSync(
      fixture.repositoryPath,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

async function main() {
  console.log(
    "\n=== DeployGuard Git Commit Adversarial Tests ===\n"
  );

  await testWrongSigningSecret();
  await testExpiredAuthorization();
  await testBranchDrift();
  await testHeadDrift();
  await testWorkingTreeDrift();
  await testValidCommit();

  console.log(
    "\n✓ Git commit executor adversarial boundary passed."
  );
}

void main();