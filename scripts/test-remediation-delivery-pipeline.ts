import "dotenv/config";

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
  execFileSync,
} from "node:child_process";

import {
  prisma,
} from "@/lib/database/prisma";

import {
  commitPersistedRemediationDelivery,
  preparePersistedRemediationDelivery,
} from "@/lib/remediation/remediation-delivery-pipeline";

import {
  persistVerifiedArtifact,
} from "@/lib/remediation/trusted-artifact-repository";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

function runGit(
  repositoryPath: string,
  args: string[]
): string {
  return execFileSync(
    "git",
    args,
    {
      cwd: repositoryPath,
      encoding: "utf8",
    }
  ).trim();
}

async function main() {
  const repositoryIdentity =
    "deployguard-test/delivery-pipeline";

  const signingSecret =
    "deployguard-delivery-pipeline-test-secret";

  const repositoryPath =
    mkdtempSync(
      join(
        tmpdir(),
        "deployguard-delivery-pipeline-"
      )
    );

  const artifactIds:
    string[] = [];

  const deliveryIds:
    string[] = [];

  try {
    /*
     * Construct a real Git repository with one
     * immutable baseline commit.
     */
    // runGit(
    //   repositoryPath,
    //   [
    //     "init",
    //     "-b",
    //     "main",
    //   ]
    // );
    runGit(
  repositoryPath,
  [
    "init",
  ]
);

runGit(
  repositoryPath,
  [
    "checkout",
    "-b",
    "main",
  ]
);
    
    
    runGit(
      repositoryPath,
      [
        "config",
        "user.name",
        "DeployGuard Test",
      ]
    );

    runGit(
      repositoryPath,
      [
        "config",
        "user.email",
        "deployguard@example.test",
      ]
    );

    const targetPath =
      join(
        repositoryPath,
        "example.ts"
      );

    writeFileSync(
      targetPath,
      'export const secure = false;\n',
      "utf8"
    );

    runGit(
      repositoryPath,
      [
        "add",
        "example.ts",
      ]
    );

    runGit(
      repositoryPath,
      [
        "commit",
        "-m",
        "initial fixture",
      ]
    );

    const originalHead =
      runGit(
        repositoryPath,
        [
          "rev-parse",
          "HEAD",
        ]
      );

    /*
     * Generate the patch from Git itself so this
     * fixture exercises the real Git apply path.
     */
    writeFileSync(
      targetPath,
      'export const secure = true;\n',
      "utf8"
    );

    const content =
      execFileSync(
        "git",
        [
          "diff",
          "--binary",
          "HEAD",
        ],
        {
          cwd:
            repositoryPath,

          encoding:
            "utf8",
        }
      );

    runGit(
      repositoryPath,
      [
        "reset",
        "--hard",
        originalHead,
      ]
    );

    const artifact:
      VerifiedPatchArtifact = {
        format:
          "unified_diff",

        content,

        sha256:
          createHash("sha256")
            .update(content)
            .digest("hex"),

        byteSize:
          Buffer.byteLength(
            content,
            "utf8"
          ),
      };

    /*
     * Persist the independently verified evidence.
     */
    const persisted =
      await persistVerifiedArtifact(
        repositoryIdentity,
        artifact
      );

    artifactIds.push(
      persisted.id
    );

    console.log(
      "✓ Verified artifact persisted."
    );

    /*
     * Cross-repository replay must be rejected
     * before any Git mutation occurs.
     */
    const mismatch =
      await preparePersistedRemediationDelivery(
        repositoryPath,
        "deployguard-test/other-repository",
        persisted.id,
        signingSecret
      );

    if (
      mismatch.status !==
      "repository_mismatch"
    ) {
      throw new Error(
        `Expected repository_mismatch, received ${mismatch.status}.`
      );
    }

    const headAfterMismatch =
      runGit(
        repositoryPath,
        [
          "rev-parse",
          "HEAD",
        ]
      );

    const branchAfterMismatch =
      runGit(
        repositoryPath,
        [
          "branch",
          "--show-current",
        ]
      );

    const statusAfterMismatch =
      runGit(
        repositoryPath,
        [
          "status",
          "--porcelain",
        ]
      );

    if (
      headAfterMismatch !==
        originalHead ||
      branchAfterMismatch !==
        "main" ||
      statusAfterMismatch !==
        ""
    ) {
      throw new Error(
        "Repository mismatch mutated the Git workspace."
      );
    }

    console.log(
      "✓ Cross-repository artifact delivery rejected without Git mutation."
    );

    /*
     * Execute the authorized preparation path.
     */
    const result =
      await preparePersistedRemediationDelivery(
        repositoryPath,
        repositoryIdentity,
        persisted.id,
        signingSecret
      );

    if (
      result.status !==
        "prepared" ||
      !result.delivery ||
      !result.gitDelivery
    ) {
      throw new Error(
        `Delivery preparation failed: ${result.summary}`
      );
    }

    deliveryIds.push(
      result.delivery.id
    );

    console.log(
      "✓ Persisted artifact crossed authorized Git preparation boundary."
    );

    if (
      result.delivery.status !==
        "PREPARED"
    ) {
      throw new Error(
        "Prepared Git delivery was not persisted as PREPARED."
      );
    }

    if (
      result.delivery.artifactId !==
        persisted.id ||
      result.delivery.repositoryIdentity !==
        repositoryIdentity
    ) {
      throw new Error(
        "Persisted delivery identity differs from authorized artifact."
      );
    }

    console.log(
      "✓ Durable PREPARED delivery record created."
    );

    /*
     * Independently observe the real Git state.
     */
    const currentBranch =
      runGit(
        repositoryPath,
        [
          "branch",
          "--show-current",
        ]
      );

    const currentHead =
      runGit(
        repositoryPath,
        [
          "rev-parse",
          "HEAD",
        ]
      );

    const workingStatus =
      runGit(
        repositoryPath,
        [
          "status",
          "--porcelain",
        ]
      );

    if (
      currentBranch !==
        result.delivery.branchName
    ) {
      throw new Error(
        "Current Git branch differs from persisted PREPARED branch."
      );
    }

    if (
      currentHead !==
        originalHead ||
      result.delivery.originalHead !==
        originalHead
    ) {
      throw new Error(
        "Original Git HEAD was not preserved."
      );
    }

    if (!workingStatus) {
      throw new Error(
        "Prepared remediation unexpectedly produced a clean workspace."
      );
    }

    console.log(
      "✓ Real Git repository reflects persisted PREPARED state."
    );

    /*
     * Independently calculate the prepared diff
     * identity and compare it with both Git
     * delivery and durable database evidence.
     */
    const preparedDiff =
      execFileSync(
        "git",
        [
          "diff",
          "--binary",
          "HEAD",
        ],
        {
          cwd:
            repositoryPath,

          encoding:
            "utf8",
        }
      );

    const preparedDiffSha256 =
      createHash("sha256")
        .update(preparedDiff)
        .digest("hex");

    if (
      preparedDiffSha256 !==
        result.delivery
          .preparedDiffSha256 ||
      preparedDiffSha256 !==
        result.gitDelivery
          .preparedDiffSha256
    ) {
      throw new Error(
        "Prepared Git diff identity differs from durable delivery evidence."
      );
    }

    console.log(
      "✓ Prepared Git diff cryptographically matches durable audit evidence."
    );

    /*
     * Independently reload the database row.
     */
    const storedDelivery =
      await prisma
        .remediationDelivery
        .findUnique({
          where: {
            id:
              result.delivery.id,
          },
        });

    if (
      !storedDelivery ||
      storedDelivery.status !==
        "PREPARED" ||
      storedDelivery.artifactId !==
        persisted.id ||
      storedDelivery.originalHead !==
        originalHead ||
      storedDelivery.branchName !==
        currentBranch ||
      storedDelivery.preparedDiffSha256 !==
        preparedDiffSha256
    ) {
      throw new Error(
        "Database PREPARED record differs from independently observed Git state."
      );
    }

    console.log(
      "✓ Database PREPARED record independently verified."
    );

    /*
 * The durable PREPARED record now describes the
 * exact Git state authorized to cross the commit
 * boundary.
 *
 * Commit authority must still be freshly issued
 * and independently verified by the executor.
 */
const commitResult =
  await commitPersistedRemediationDelivery(
    repositoryPath,
    repositoryIdentity,
    result.delivery.id,
    signingSecret
  );

if (
  commitResult.status !==
    "committed" ||
  !commitResult.commitSha ||
  !commitResult.delivery ||
  !commitResult.gitCommit
) {
  throw new Error(
    `Persisted remediation commit failed: ${commitResult.summary}`
  );
}

console.log(
  "✓ PREPARED remediation crossed authorized Git commit boundary."
);

if (
  commitResult.delivery.status !==
    "COMMITTED"
) {
  throw new Error(
    "Successful Git commit was not durably recorded as COMMITTED."
  );
}

console.log(
  "✓ PREPARED → COMMITTED transition persisted."
);

/*
 * Independently inspect Git rather than trusting
 * the commit executor result.
 */
const committedHead =
  runGit(
    repositoryPath,
    [
      "rev-parse",
      "HEAD",
    ]
  );

if (
  committedHead !==
    commitResult.commitSha
) {
  throw new Error(
    "Current Git HEAD differs from the committed remediation SHA."
  );
}

if (
  committedHead ===
    originalHead
) {
  throw new Error(
    "Remediation commit did not advance Git HEAD."
  );
}

console.log(
  "✓ Immutable remediation commit independently observed."
);

/*
 * The remediation commit must descend directly
 * from the original immutable repository HEAD.
 */
const commitParent =
  runGit(
    repositoryPath,
    [
      "rev-parse",
      `${committedHead}^`,
    ]
  );

if (
  commitParent !==
    originalHead
) {
  throw new Error(
    "Remediation commit parent differs from the authorized original HEAD."
  );
}

console.log(
  "✓ Remediation commit preserves authorized parent HEAD."
);

/*
 * The commit executor should leave no residual
 * uncommitted mutation behind.
 */
const statusAfterCommit =
  runGit(
    repositoryPath,
    [
      "status",
      "--porcelain",
    ]
  );

if (
  statusAfterCommit !==
    ""
) {
  throw new Error(
    "Working tree is not clean after verified remediation commit."
  );
}

console.log(
  "✓ Working tree clean after verified commit."
);

/*
 * Reload durable state independently.
 */
const committedDatabaseRecord =
  await prisma
    .remediationDelivery
    .findUnique({
      where: {
        id:
          result.delivery.id,
      },
    });

if (
  !committedDatabaseRecord ||
  committedDatabaseRecord.status !==
    "COMMITTED" ||
  committedDatabaseRecord.commitSha !==
    committedHead ||
  !committedDatabaseRecord.committedAt
) {
  throw new Error(
    "Durable COMMITTED evidence differs from independently observed Git commit."
  );
}

console.log(
  "✓ Database COMMITTED evidence independently verified."
);

/*
 * COMMITTED is not replayable through the
 * PREPARED → COMMITTED orchestration boundary.
 */
const replayResult =
  await commitPersistedRemediationDelivery(
    repositoryPath,
    repositoryIdentity,
    result.delivery.id,
    signingSecret
  );

if (
  replayResult.status !==
    "invalid_delivery_state"
) {
  throw new Error(
    `Expected committed delivery replay rejection, received ${replayResult.status}.`
  );
}

const headAfterReplay =
  runGit(
    repositoryPath,
    [
      "rev-parse",
      "HEAD",
    ]
  );

if (
  headAfterReplay !==
    committedHead
) {
  throw new Error(
    "Rejected commit replay mutated Git history."
  );
}

console.log(
  "✓ COMMITTED delivery replay rejected without Git mutation."
);

    console.log(
      "\n✓ Persisted remediation delivery pipeline passed."
    );
  } finally {
    /*
     * Remove delivery rows before artifacts
     * because the database intentionally enforces
     * ON DELETE RESTRICT.
     */
    if (
      deliveryIds.length > 0
    ) {
      await prisma
        .remediationDelivery
        .deleteMany({
          where: {
            id: {
              in:
                deliveryIds,
            },
          },
        });
    }

    if (
      artifactIds.length > 0
    ) {
      await prisma
        .verifiedRemediationArtifact
        .deleteMany({
          where: {
            id: {
              in:
                artifactIds,
            },
          },
        });
    }

    await prisma.$disconnect();

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