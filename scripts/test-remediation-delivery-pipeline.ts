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