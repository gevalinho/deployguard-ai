import {
  issueArtifactAccessCapability,
} from "@/lib/remediation/artifact-access-capability";

import {
  signArtifactAccessCapability,
  verifySignedArtifactAccessCapability,
} from "@/lib/remediation/artifact-capability-signing";

const signingSecret =
  "deployguard-test-signing-secret";

const artifactSha256 =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const capability =
  issueArtifactAccessCapability(
    "trusted_agent",
    artifactSha256
  );

const signed =
  signArtifactAccessCapability(
    capability,
    signingSecret
  );

/*
 * A capability signed by DeployGuard must verify.
 */

if (
  !verifySignedArtifactAccessCapability(
    signed,
    signingSecret
  )
) {
  throw new Error(
    "Valid signed capability was rejected."
  );
}

console.log(
  "✓ Valid artifact capability signature accepted."
);

/*
 * Changing the artifact identity after signing
 * must invalidate the signature.
 */

const tamperedArtifact = {
  ...signed,

  capability: {
    ...signed.capability,

    artifactSha256:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
};

if (
  verifySignedArtifactAccessCapability(
    tamperedArtifact,
    signingSecret
  )
) {
  throw new Error(
    "Tampered artifact identity passed signature verification."
  );
}

console.log(
  "✓ Tampered artifact identity rejected."
);

/*
 * Changing the authorized consumer must also
 * invalidate the signature.
 */

const tamperedConsumer = {
  ...signed,

  capability: {
    ...signed.capability,

    consumer:
      "github_integration" as const,
  },
};

if (
  verifySignedArtifactAccessCapability(
    tamperedConsumer,
    signingSecret
  )
) {
  throw new Error(
    "Tampered capability consumer passed signature verification."
  );
}

console.log(
  "✓ Tampered capability consumer rejected."
);

/*
 * Changing expiry after issuance must invalidate
 * the signature.
 */

const tamperedExpiry = {
  ...signed,

  capability: {
    ...signed.capability,

    expiresAt:
      signed.capability.expiresAt +
      60_000,
  },
};

if (
  verifySignedArtifactAccessCapability(
    tamperedExpiry,
    signingSecret
  )
) {
  throw new Error(
    "Tampered capability expiry passed signature verification."
  );
}

console.log(
  "✓ Tampered capability expiry rejected."
);

/*
 * A signature created with another secret must
 * not verify against DeployGuard's secret.
 */

const wrongSecretSigned =
  signArtifactAccessCapability(
    capability,
    "attacker-controlled-secret"
  );

if (
  verifySignedArtifactAccessCapability(
    wrongSecretSigned,
    signingSecret
  )
) {
  throw new Error(
    "Capability signed with the wrong secret was accepted."
  );
}

console.log(
  "✓ Capability signed with wrong secret rejected."
);