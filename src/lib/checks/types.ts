export type CheckStatus =
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "error";

export type CheckCategory =
  | "build"
  | "types"
  | "lint"
  | "test"
  | "security"
  | "database"
  | "deployment"
  | "environment";

export type SkipReason =
  | "not_applicable"
  | "not_configured"
  | "unsupported";

 export type CheckEvidenceKind =
  | "error"
  | "warning"
  | "test_failure"
  | "security_finding"
  | "diagnostic";

export interface CheckEvidence {
  kind: CheckEvidenceKind;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  advisoryIds?: string[];

  /**
   * Verified dependency exposure for security findings.
   * Unknown means the dependency scope has not been established.
   */
  dependencyScope?: "production" | "development" | "both" | "unknown";
} 

export interface CheckConfigurationRequirement {
  variable: string;

  phase:
    | "build"
    | "runtime"
    | "test"
    | "unknown";

  reason: string;
}

export interface CheckResult {
  /** Trusted internal classification; omitted from the public check allowlist. */
  transientFailure?: "audit_service" | "approved_build_asset";
  infrastructureFailure?: "docker_unavailable";
  blockedByExternalNetwork?: boolean;
  /** Set only when a trusted preparation stage attributes an error to repository input. */
  failureOrigin?: "repository";
  id: string;
  category: CheckCategory;
  name: string;
  status: CheckStatus;
  skipReason?: SkipReason;
  /** Trusted check policy: absence of this specific configuration disqualifies readiness. */
  requiredForReadiness?: boolean;

  command?: string;
  exitCode?: number | null;
  /** Set only when the sandbox's trusted runner observed an executed test. */
  testExecutionVerified?: boolean;
  durationMs?: number;

  summary: string;

  stdout?: string;
  stderr?: string;

  evidence?: CheckEvidence[];

  configurationRequirements?:
    CheckConfigurationRequirement[];
}
