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
}