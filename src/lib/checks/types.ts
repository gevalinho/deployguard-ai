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
} 

export interface CheckResult {
  id: string;
  category: CheckCategory;
  name: string;
  status: CheckStatus;
  skipReason?: SkipReason;

  command?: string;
  exitCode?: number | null;
  durationMs?: number;

  summary: string;

  stdout?: string;
  stderr?: string;

  evidence?: CheckEvidence[];
}