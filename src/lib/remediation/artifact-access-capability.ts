import type {
  ArtifactConsumer,
} from "@/lib/remediation/artifact-access-policy";

export interface ArtifactAccessCapability {
  consumer:
    | "trusted_agent"
    | "github_integration";

  artifactSha256: string;

  permission:
    "read_verified_artifact";

  issuedAt: number;
  expiresAt: number;
}

const CAPABILITY_TTL_MS =
  5 * 60 * 1000;

export function issueArtifactAccessCapability(
  consumer:
    | "trusted_agent"
    | "github_integration",
  artifactSha256: string,
  now = Date.now()
): ArtifactAccessCapability {
  return {
    consumer,
    artifactSha256,
    permission:
      "read_verified_artifact",

    issuedAt: now,

    expiresAt:
      now +
      CAPABILITY_TTL_MS,
  };
}

export function validateArtifactAccessCapability(
  capability:
    ArtifactAccessCapability,
  consumer: ArtifactConsumer,
  artifactSha256: string,
  now = Date.now()
): boolean {
  if (
    consumer !== "trusted_agent" &&
    consumer !== "github_integration"
  ) {
    return false;
  }

  return (
    capability.consumer === consumer &&
    capability.permission ===
      "read_verified_artifact" &&
    capability.artifactSha256 ===
      artifactSha256 &&
    capability.issuedAt <= now &&
    capability.expiresAt > now
  );
}