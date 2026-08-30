export type CheckStatus = "passed" | "failed" | "skipped";

export type CheckCategory =
  | "build"
  | "types"
  | "lint"
  | "test"
  | "security"
  | "database"
  | "deployment";

export interface CheckResult {
  id: string;
  category: CheckCategory;
  name: string;
  status: CheckStatus;

  command?: string;
  exitCode?: number | null;
  durationMs?: number;

  summary: string;

  stdout?: string;
  stderr?: string;
}