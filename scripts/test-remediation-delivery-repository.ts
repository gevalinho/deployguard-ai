import "dotenv/config";

import {
  createHash,
} from "node:crypto";

import {
  prisma,
} from "@/lib/database/prisma";

import {
  createPreparedDelivery,
  getRemediationDelivery,
  markDeliveryCommitted,
  markDeliveryFailed,
  markDeliveryPushed,
} from "@/lib/remediation/remediation-delivery-repository";

import {
  persistVerifiedArtifact,
} from "@/lib/remediation/trusted-artifact-repository";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

async function main() {
  const repositoryIdentity =
    "deployguard-test/remediation-delivery";

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

  let artifactId:
    | string
    | undefined;

  let deliveryId:
    | string
    | undefined;

  try {
    /*
     * Establish immutable verified evidence.
     */
    const storedArtifact =
      await persistVerifiedArtifact(
        repositoryIdentity,
        artifact
      );

    artifactId =
      storedArtifact.id;

    /*
     * PREPARED
     */
    const prepared =
      await createPreparedDelivery({
        artifactId:
          storedArtifact.id,

        repositoryIdentity,

        originalHead:
          "1111111111111111111111111111111111111111",

        branchName:
          "deployguard/remediation-test",

        preparedDiffSha256:
          sha256,
      });

    deliveryId =
      prepared.id;

    if (
      prepared.status !==
      "PREPARED"
    ) {
      throw new Error(
        "Delivery was not created in PREPARED state."
      );
    }

    console.log(
      "✓ Delivery persisted in PREPARED state."
    );

    /*
     * PREPARED must not skip directly to PUSHED.
     */
    const prematurePush =
      await markDeliveryPushed(
        prepared.id,
        "origin"
      );

    if (
      prematurePush !== null
    ) {
      throw new Error(
        "PREPARED delivery unexpectedly transitioned directly to PUSHED."
      );
    }

    console.log(
      "✓ PREPARED → PUSHED transition rejected."
    );

    /*
     * COMMITTED
     */
    const commitSha =
      "2222222222222222222222222222222222222222";

    const committed =
      await markDeliveryCommitted(
        prepared.id,
        commitSha
      );

    if (
      !committed ||
      committed.status !==
        "COMMITTED" ||
      committed.commitSha !==
        commitSha ||
      !committed.committedAt
    ) {
      throw new Error(
        "PREPARED → COMMITTED transition was not persisted correctly."
      );
    }

    console.log(
      "✓ PREPARED → COMMITTED transition persisted."
    );

    /*
     * COMMITTED must not be committed twice.
     */
    const duplicateCommit =
      await markDeliveryCommitted(
        prepared.id,
        commitSha
      );

    if (
      duplicateCommit !== null
    ) {
      throw new Error(
        "COMMITTED delivery unexpectedly accepted a second commit transition."
      );
    }

    console.log(
      "✓ Duplicate COMMITTED transition rejected."
    );

    /*
     * PUSHED
     */
    const pushed =
      await markDeliveryPushed(
        prepared.id,
        "origin"
      );

    if (
      !pushed ||
      pushed.status !==
        "PUSHED" ||
      pushed.remoteName !==
        "origin" ||
      !pushed.pushedAt
    ) {
      throw new Error(
        "COMMITTED → PUSHED transition was not persisted correctly."
      );
    }

    console.log(
      "✓ COMMITTED → PUSHED transition persisted."
    );

    /*
     * PUSHED is terminal.
     */
    const failedAfterPush =
      await markDeliveryFailed(
        prepared.id
      );

    if (
      failedAfterPush !== null
    ) {
      throw new Error(
        "PUSHED delivery unexpectedly transitioned to FAILED."
      );
    }

    const commitAfterPush =
      await markDeliveryCommitted(
        prepared.id,
        commitSha
      );

    if (
      commitAfterPush !== null
    ) {
      throw new Error(
        "PUSHED delivery unexpectedly transitioned back to COMMITTED."
      );
    }

    console.log(
      "✓ PUSHED state is terminal."
    );

    /*
     * Independently reload the record.
     */
    const persisted =
      await getRemediationDelivery(
        prepared.id
      );

    if (
      !persisted ||
      persisted.status !==
        "PUSHED" ||
      persisted.commitSha !==
        commitSha ||
      persisted.remoteName !==
        "origin"
    ) {
      throw new Error(
        "Persisted delivery audit state differs from expected final state."
      );
    }

    console.log(
      "✓ Final delivery audit state independently retrieved."
    );

    /*
     * PostgreSQL must protect evidence referenced
     * by a delivery record.
     */
    let artifactDeletionRejected =
      false;

    try {
      await prisma
        .verifiedRemediationArtifact
        .delete({
          where: {
            id:
              storedArtifact.id,
          },
        });
    } catch {
      artifactDeletionRejected =
        true;
    }

    if (
      !artifactDeletionRejected
    ) {
      throw new Error(
        "Referenced verified artifact was unexpectedly deletable."
      );
    }

    console.log(
      "✓ Referenced verified artifact protected by foreign-key constraint."
    );

    /*
     * Prove FAILED is also terminal.
     *
     * Use a second delivery because the first has
     * already successfully reached PUSHED.
     */
    const failureDelivery =
      await createPreparedDelivery({
        artifactId:
          storedArtifact.id,

        repositoryIdentity,

        originalHead:
          "3333333333333333333333333333333333333333",

        branchName:
          "deployguard/remediation-failure-test",

        preparedDiffSha256:
          sha256,
      });

    const failed =
      await markDeliveryFailed(
        failureDelivery.id
      );

    if (
      !failed ||
      failed.status !==
        "FAILED"
    ) {
      throw new Error(
        "PREPARED → FAILED transition was not persisted."
      );
    }

    const commitAfterFailure =
      await markDeliveryCommitted(
        failureDelivery.id,
        commitSha
      );

    const pushAfterFailure =
      await markDeliveryPushed(
        failureDelivery.id,
        "origin"
      );

    if (
      commitAfterFailure !== null ||
      pushAfterFailure !== null
    ) {
      throw new Error(
        "FAILED delivery unexpectedly accepted another lifecycle transition."
      );
    }

    console.log(
      "✓ FAILED state is terminal."
    );

    /*
     * Remove the secondary fixture now so the
     * primary cleanup below can remove evidence.
     */
    await prisma
      .remediationDelivery
      .delete({
        where: {
          id:
            failureDelivery.id,
        },
      });

    console.log(
      "\n✓ Remediation Delivery Repository state-machine boundary passed."
    );
  } finally {
    /*
     * Tests may delete fixtures explicitly.
     * Production audit records should not use
     * this cleanup path.
     */
    if (deliveryId) {
      await prisma
        .remediationDelivery
        .deleteMany({
          where: {
            id:
              deliveryId,
          },
        });
    }

    if (artifactId) {
      await prisma
        .verifiedRemediationArtifact
        .deleteMany({
          where: {
            id:
              artifactId,
          },
        });
    }

    await prisma.$disconnect();
  }
}

void main();