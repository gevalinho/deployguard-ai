
import "dotenv/config";
import {
  createHash,
} from "node:crypto";

import {
  prisma,
} from "@/lib/database/prisma";

import {
  getTrustedVerifiedArtifact,
  getVerifiedArtifactMetadata,
  persistVerifiedArtifact,
} from "@/lib/remediation/trusted-artifact-repository";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

async function main() {
  const repositoryIdentity =
    "deployguard-test/trusted-artifact-repository";

  const content =
    `diff --git a/example.js b/example.js
--- a/example.js
+++ b/example.js
@@ -1 +1 @@
-const message = "old";
+const message = "new";
`;

  const artifact: VerifiedPatchArtifact = {
    format: "unified_diff",

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

  let storedId:
    | string
    | undefined;

  try {
    /*
     * Persist verified evidence.
     *
     * The public result must contain metadata,
     * never the source-bearing artifact content.
     */
    const stored =
      await persistVerifiedArtifact(
        repositoryIdentity,
        artifact
      );

    storedId =
      stored.id;

    if (
      "content" in stored
    ) {
      throw new Error(
        "Persistence boundary exposed private artifact content."
      );
    }

    console.log(
      "✓ Verified artifact persisted without exposing content."
    );

    if (
      stored.sha256 !==
        artifact.sha256 ||
      stored.byteSize !==
        artifact.byteSize ||
      stored.repositoryIdentity !==
        repositoryIdentity
    ) {
      throw new Error(
        "Persisted artifact metadata does not match verified evidence."
      );
    }

    console.log(
      "✓ Persisted metadata matches verified artifact identity."
    );

    /*
     * Public metadata retrieval must also exclude
     * the private patch content.
     */
    const metadata =
      await getVerifiedArtifactMetadata(
        stored.id
      );

    if (!metadata) {
      throw new Error(
        "Persisted artifact metadata could not be retrieved."
      );
    }

    if (
      "content" in metadata
    ) {
      throw new Error(
        "Metadata repository boundary exposed artifact content."
      );
    }

    console.log(
      "✓ Metadata retrieval preserved content boundary."
    );

    /*
     * Trusted server-side retrieval may access
     * the complete verified artifact.
     */
    const trusted =
      await getTrustedVerifiedArtifact(
        stored.id
      );

    if (!trusted) {
      throw new Error(
        "Trusted artifact could not be retrieved."
      );
    }

    if (
      trusted.content !==
      artifact.content
    ) {
      throw new Error(
        "Trusted artifact content differs from persisted evidence."
      );
    }

    const recomputedSha256 =
      createHash("sha256")
        .update(
          trusted.content
        )
        .digest("hex");

    if (
      recomputedSha256 !==
      trusted.sha256
    ) {
      throw new Error(
        "Persisted artifact failed independent SHA-256 verification."
      );
    }

    if (
      Buffer.byteLength(
        trusted.content,
        "utf8"
      ) !== trusted.byteSize
    ) {
      throw new Error(
        "Persisted artifact failed independent byte-size verification."
      );
    }

    console.log(
      "✓ Trusted artifact independently verified after database retrieval."
    );

    console.log(
      "\n✓ Trusted Artifact Repository persistence boundary passed."
    );
  } finally {
    /*
     * Remove only this test fixture.
     *
     * Production evidence must not use this
     * deletion path.
     */
    if (storedId) {
      await prisma
        .verifiedRemediationArtifact
        .delete({
          where: {
            id: storedId,
          },
        });
    }

    await prisma.$disconnect();
  }
}

void main();