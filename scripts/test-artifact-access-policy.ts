import {
  authorizeArtifactAccess,
} from "@/lib/remediation/artifact-access-policy";

import {
  issueArtifactAccessCapability,
} from "@/lib/remediation/artifact-access-capability";

import {
  signArtifactAccessCapability,
} from "@/lib/remediation/artifact-capability-signing";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

const signingSecret =
  "deployguard-test-signing-secret";

const secret =
  "DEPLOYGUARD_PRIVATE_PATCH_CONTENT";

const artifact: VerifiedPatchArtifact = {
  format: "unified_diff",

  content: `diff --git a/example.js b/example.js
-${secret}
+safe replacement
`,

  sha256:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",

  byteSize: 123,
};

/*
 * Public consumers receive metadata only.
 */

const publicAccess =
  authorizeArtifactAccess(
    artifact,
    "public_api"
  );

const dashboardAccess =
  authorizeArtifactAccess(
    artifact,
    "dashboard"
  );

/*
 * Trusted consumers require capabilities issued
 * by DeployGuard and cryptographically signed.
 */

const agentCapability =
  signArtifactAccessCapability(
    issueArtifactAccessCapability(
      "trusted_agent",
      artifact.sha256
    ),
    signingSecret
  );

const githubCapability =
  signArtifactAccessCapability(
    issueArtifactAccessCapability(
      "github_integration",
      artifact.sha256
    ),
    signingSecret
  );

/*
 * Authorized consumers must present both the
 * signed capability and the signing secret used
 * by the trusted authorization boundary.
 */

const agentAccess =
  authorizeArtifactAccess(
    artifact,
    "trusted_agent",
    agentCapability,
    signingSecret
  );

const githubAccess =
  authorizeArtifactAccess(
    artifact,
    "github_integration",
    githubCapability,
    signingSecret
  );

/*
 * Merely claiming to be a trusted consumer must
 * never grant private artifact access.
 */

const unauthorizedAgentAccess =
  authorizeArtifactAccess(
    artifact,
    "trusted_agent"
  );

if (
  unauthorizedAgentAccess.access !==
    "metadata" ||
  unauthorizedAgentAccess.content !==
    undefined
) {
  throw new Error(
    "Trusted agent received artifact content without a signed capability."
  );
}

console.log(
  "✓ Uncredentialed trusted agent denied artifact content."
);

/*
 * An expired capability must remain invalid even
 * when it carries a cryptographically valid
 * signature.
 *
 * This distinguishes authenticity from temporal
 * authorization.
 */

const now =
  Date.now();

const expiredCapability =
  signArtifactAccessCapability(
    issueArtifactAccessCapability(
      "trusted_agent",
      artifact.sha256,
      now - 10 * 60 * 1000
    ),
    signingSecret
  );

const expiredAccess =
  authorizeArtifactAccess(
    artifact,
    "trusted_agent",
    expiredCapability,
    signingSecret
  );

if (
  expiredAccess.access !==
    "metadata" ||
  expiredAccess.content !==
    undefined
) {
  throw new Error(
    "Expired signed capability authorized private artifact content."
  );
}

console.log(
  "✓ Expired signed artifact capability rejected."
);

/*
 * A correctly structured and correctly signed
 * capability must still fail when verification
 * uses the wrong trust secret.
 */

const wrongSecretAccess =
  authorizeArtifactAccess(
    artifact,
    "trusted_agent",
    agentCapability,
    "attacker-controlled-secret"
  );

if (
  wrongSecretAccess.access !==
    "metadata" ||
  wrongSecretAccess.content !==
    undefined
) {
  throw new Error(
    "Artifact content was authorized with the wrong signing secret."
  );
}

console.log(
  "✓ Wrong signing secret denied artifact content."
);

/*
 * A capability for one trusted consumer cannot
 * be replayed by another trusted consumer.
 */

const crossConsumerAccess =
  authorizeArtifactAccess(
    artifact,
    "github_integration",
    agentCapability,
    signingSecret
  );

if (
  crossConsumerAccess.access !==
    "metadata" ||
  crossConsumerAccess.content !==
    undefined
) {
  throw new Error(
    "Trusted-agent capability was replayed by the GitHub integration."
  );
}

console.log(
  "✓ Cross-consumer capability replay rejected."
);

/*
 * A signed capability bound to another artifact
 * cannot authorize this artifact.
 */

const otherArtifactCapability =
  signArtifactAccessCapability(
    issueArtifactAccessCapability(
      "trusted_agent",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    ),
    signingSecret
  );

const wrongArtifactAccess =
  authorizeArtifactAccess(
    artifact,
    "trusted_agent",
    otherArtifactCapability,
    signingSecret
  );

if (
  wrongArtifactAccess.access !==
    "metadata" ||
  wrongArtifactAccess.content !==
    undefined
) {
  throw new Error(
    "Capability for another artifact authorized private content."
  );
}

console.log(
  "✓ Cross-artifact capability replay rejected."
);

/*
 * Public consumers must never receive source
 * artifact content.
 */

for (const access of [
  publicAccess,
  dashboardAccess,
]) {
  if (
    access.access !==
    "metadata"
  ) {
    throw new Error(
      `${access.consumer} received unexpected artifact access.`
    );
  }

  if (
    access.content !==
    undefined
  ) {
    throw new Error(
      `${access.consumer} received private artifact content.`
    );
  }

  if (
    JSON.stringify(
      access
    ).includes(secret)
  ) {
    throw new Error(
      `${access.consumer} leaked private artifact content.`
    );
  }
}

/*
 * Properly authenticated trusted consumers may
 * receive verified artifact content.
 */

for (const access of [
  agentAccess,
  githubAccess,
]) {
  if (
    access.access !==
    "content"
  ) {
    throw new Error(
      `${access.consumer} did not receive authorized content access.`
    );
  }

  if (
    !access.content?.includes(
      secret
    )
  ) {
    throw new Error(
      `${access.consumer} did not receive the verified artifact content.`
    );
  }
}

/*
 * Every consumer receives the same immutable
 * artifact identity regardless of access level.
 */

for (const access of [
  publicAccess,
  dashboardAccess,
  agentAccess,
  githubAccess,
]) {
  if (
    access.metadata.sha256 !==
    artifact.sha256
  ) {
    throw new Error(
      `${access.consumer} received the wrong artifact identity.`
    );
  }
}

console.log(
  "✓ Public API restricted to artifact metadata."
);

console.log(
  "✓ Dashboard restricted to artifact metadata."
);

console.log(
  "✓ Trusted agent authorized with signed capability."
);

console.log(
  "✓ GitHub integration authorized with signed capability."
);

console.log(
  "✓ Artifact identity preserved across trust boundaries."
);