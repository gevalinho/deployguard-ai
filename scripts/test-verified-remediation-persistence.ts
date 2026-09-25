import "dotenv/config";

import {
  createHash,
} from "node:crypto";

import {
  prisma,
} from "@/lib/database/prisma";

import {
  persistProvenRemediationArtifact,
} from "@/lib/remediation/verified-remediation-persistence";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

async function main() {
  const repositoryIdentity =
    "deployguard-test/remediation-persistence-boundary";

  const content =
    `diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1,1 +1,1 @@
-const secure = false;
+const secure = true;
`;

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

  const createdIds:
    string[] = [];

  try {
    /*
     * Failed proof must never persist evidence.
     */
    const failed =
      await persistProvenRemediationArtifact(
        repositoryIdentity,
        "failed",
        artifact
      );

    if (failed !== null) {
      throw new Error(
        "Failed remediation unexpectedly persisted an artifact."
      );
    }

    console.log(
      "✓ Failed remediation denied persistence."
    );

    /*
     * Inconclusive proof must also fail closed.
     */
    const inconclusive =
      await persistProvenRemediationArtifact(
        repositoryIdentity,
        "inconclusive",
        artifact
      );

    if (
      inconclusive !== null
    ) {
      throw new Error(
        "Inconclusive remediation unexpectedly persisted an artifact."
      );
    }

    console.log(
      "✓ Inconclusive remediation denied persistence."
    );

    /*
     * Even a proven status without actual verified
     * evidence must not create a database record.
     */
    const missingArtifact =
      await persistProvenRemediationArtifact(
        repositoryIdentity,
        "proven",
        undefined
      );

    if (
      missingArtifact !== null
    ) {
      throw new Error(
        "Missing verified artifact unexpectedly crossed persistence boundary."
      );
    }

    console.log(
      "✓ Missing verified artifact denied persistence."
    );

    /*
     * Independently proven evidence may cross the
     * durable boundary.
     */
    const persisted =
      await persistProvenRemediationArtifact(
        repositoryIdentity,
        "proven",
        artifact
      );

    if (!persisted) {
      throw new Error(
        "Proven verified artifact was not persisted."
      );
    }

    createdIds.push(
      persisted.id
    );

    if (
      persisted.sha256 !==
        artifact.sha256 ||
      persisted.byteSize !==
        artifact.byteSize
    ) {
      throw new Error(
        "Persisted identity differs from verified artifact."
      );
    }

    console.log(
      "✓ Proven verified artifact persisted."
    );

    /*
     * Independently inspect the database.
     */
    const stored =
      await prisma
        .verifiedRemediationArtifact
        .findUnique({
          where: {
            id:
              persisted.id,
          },
        });

    if (
      !stored ||
      stored.content !==
        artifact.content ||
      stored.sha256 !==
        artifact.sha256
    ) {
      throw new Error(
        "Durable artifact differs from verified evidence."
      );
    }

    console.log(
      "✓ Persisted artifact independently verified from database."
    );

    /*
     * Ensure rejected attempts created no hidden
     * records.
     */
    const records =
      await prisma
        .verifiedRemediationArtifact
        .findMany({
          where: {
            repositoryIdentity,
          },

          select: {
            id: true,
          },
        });

    if (
      records.length !== 1 ||
      records[0].id !==
        persisted.id
    ) {
      throw new Error(
        "Rejected remediation attempts unexpectedly created database records."
      );
    }

    console.log(
      "✓ Rejected remediation attempts produced no durable evidence."
    );

    console.log(
      "\n✓ Verified remediation persistence boundary passed."
    );
  } finally {
    if (
      createdIds.length > 0
    ) {
      await prisma
        .verifiedRemediationArtifact
        .deleteMany({
          where: {
            id: {
              in:
                createdIds,
            },
          },
        });
    }

    await prisma.$disconnect();
  }
}

void main();