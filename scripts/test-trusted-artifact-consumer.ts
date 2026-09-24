import {
  createHash,
} from "node:crypto";

import {
  issueArtifactAccessCapability,
} from "@/lib/remediation/artifact-access-capability";

import {
  signArtifactAccessCapability,
} from "@/lib/remediation/artifact-capability-signing";

import {
  consumeVerifiedArtifact,
} from "@/lib/remediation/trusted-artifact-consumer";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

const signingSecret =
  "deployguard-test-signing-secret";

const content =
  `diff --git a/example.js b/example.js
--- a/example.js
+++ b/example.js
@@ -1,1 +1,1 @@
-const message = "old";
+const message = "new";`;

const sha256 =
  createHash("sha256")
    .update(content)
    .digest("hex");

const artifact:
  VerifiedPatchArtifact = {
    format: "unified_diff",
    content,
    sha256,

    byteSize:
      Buffer.byteLength(
        content,
        "utf8"
      ),
  };

const capability =
  issueArtifactAccessCapability(
    "trusted_agent",
    artifact.sha256
  );

const signedCapability =
  signArtifactAccessCapability(
    capability,
    signingSecret
  );

/*
 * Correctly authorized content must be consumed
 * only after its immutable identity is verified.
 */

const consumed =
  consumeVerifiedArtifact(
    artifact,
    "trusted_agent",
    signedCapability,
    signingSecret
  );

if (
  consumed.status !== "consumed"
) {
  throw new Error(
    "Authorized verified artifact was not consumed."
  );
}

if (
  consumed.content !==
  artifact.content
) {
  throw new Error(
    "Trusted consumer received unexpected artifact content."
  );
}

console.log(
  "✓ Authorized verified artifact consumed."
);

console.log(
  "✓ Artifact SHA-256 integrity verified."
);

console.log(
  "✓ Artifact byte-size integrity verified."
);

/*
 * A capability issued for another consumer must
 * not authorize this consumer.
 */

const githubCapability =
  signArtifactAccessCapability(
    issueArtifactAccessCapability(
      "github_integration",
      artifact.sha256
    ),
    signingSecret
  );

const crossConsumer =
  consumeVerifiedArtifact(
    artifact,
    "trusted_agent",
    githubCapability,
    signingSecret
  );

if (
  crossConsumer.status !== "denied"
) {
  throw new Error(
    "Cross-consumer capability unexpectedly authorized artifact access."
  );
}

console.log(
  "✓ Cross-consumer artifact access denied."
);

/*
 * A capability for another artifact identity
 * must not authorize this artifact.
 */

const otherArtifactCapability =
  signArtifactAccessCapability(
    issueArtifactAccessCapability(
      "trusted_agent",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    ),
    signingSecret
  );

const crossArtifact =
  consumeVerifiedArtifact(
    artifact,
    "trusted_agent",
    otherArtifactCapability,
    signingSecret
  );

if (
  crossArtifact.status !==
  "denied"
) {
  throw new Error(
    "Cross-artifact capability unexpectedly authorized artifact access."
  );
}

console.log(
  "✓ Cross-artifact access denied."
);

/*
 * Even authorized content must independently
 * match its advertised artifact identity.
 */

const tamperedArtifact:
  VerifiedPatchArtifact = {
    ...artifact,

    content:
      `${artifact.content}\nmalicious mutation`,
  };

const tamperedResult =
  consumeVerifiedArtifact(
    tamperedArtifact,
    "trusted_agent",
    signedCapability,
    signingSecret
  );

if (
  tamperedResult.status !==
  "integrity_failed"
) {
  throw new Error(
    "Tampered artifact content passed integrity verification."
  );
}

console.log(
  "✓ Tampered artifact content rejected."
);