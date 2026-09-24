import {
  authorizeArtifactAccess,
} from "@/lib/remediation/artifact-access-policy";

import type {
  VerifiedPatchArtifact,
} from "@/lib/remediation/verified-patch-artifact";

import {
  issueArtifactAccessCapability,
} from "@/lib/remediation/artifact-access-capability";

const secret =
  "DEPLOYGUARD_PRIVATE_PATCH_CONTENT";

const artifact: VerifiedPatchArtifact = {
  format: "unified_diff",

  content:
    `diff --git a/example.js b/example.js
-${secret}
+safe replacement
`,

  sha256:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",

  byteSize: 123,
};

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
 * Issue capabilities for consumers that are
 * allowed to receive verified artifact content.
 */

const agentCapability =
  issueArtifactAccessCapability(
    "trusted_agent",
    artifact.sha256
  );

const githubCapability =
  issueArtifactAccessCapability(
    "github_integration",
    artifact.sha256
  );

/*
 * Authorized consumers present their capability
 * when requesting artifact access.
 */

const agentAccess =
  authorizeArtifactAccess(
    artifact,
    "trusted_agent",
    agentCapability
  );

const githubAccess =
  authorizeArtifactAccess(
    artifact,
    "github_integration",
    githubCapability
  );


  /*
 * Merely claiming to be a trusted agent must
 * not grant access to private artifact content.
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
    "Trusted agent received artifact content without a capability."
  );
}

console.log(
  "✓ Uncredentialed trusted agent denied artifact content."
);

/*
 * Expired capabilities must not authorize
 * private artifact access.
 */

const now = Date.now();

const expiredCapability =
  issueArtifactAccessCapability(
    "trusted_agent",
    artifact.sha256,
    now - 10 * 60 * 1000
  );

const expiredAccess =
  authorizeArtifactAccess(
    artifact,
    "trusted_agent",
    expiredCapability
  );

if (
  expiredAccess.access !==
    "metadata" ||
  expiredAccess.content !==
    undefined
) {
  throw new Error(
    "Expired capability authorized private artifact content."
  );
}

console.log(
  "✓ Expired artifact capability rejected."
);

/*
 * Public consumers must never receive source
 * artifact content.
 */

for (const access of [
  publicAccess,
  dashboardAccess,
]) {
  if (access.access !== "metadata") {
    throw new Error(
      `${access.consumer} received unexpected artifact access.`
    );
  }

  if (access.content !== undefined) {
    throw new Error(
      `${access.consumer} received private artifact content.`
    );
  }

  if (
    JSON.stringify(access).includes(
      secret
    )
  ) {
    throw new Error(
      `${access.consumer} leaked private artifact content.`
    );
  }
}

/*
 * Trusted consumers may receive the proven
 * artifact content.
 */

for (const access of [
  agentAccess,
  githubAccess,
]) {
  if (access.access !== "content") {
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
 * artifact identity.
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
  "✓ Trusted agent authorized for artifact content."
);

console.log(
  "✓ GitHub integration authorized for artifact content."
);

console.log(
  "✓ Artifact identity preserved across trust boundaries."
);