import type {
  CheckEvidence,
  CheckResult,
} from "@/lib/checks/types";

export type FixStatus =
  | "proposed"
  | "applied"
  | "failed"
  | "unsupported";

export type ProofStatus =
  | "proven"
  | "not_proven"
  | "inconclusive";

export interface FixTarget {
  checkId: string;
  category: CheckResult["category"];
  evidenceIndexes: number[];
}

export interface FixProposal {
  id: string;
  title: string;
  description: string;
  target: FixTarget;


strategy:
  | "dependency_security"
  | "lint_autofix";

risk:
  | "safe"
  | "breaking_change_allowed";


  packageName?: string;
}

export interface FixExecutionResult {
  status: FixStatus;
  summary: string;

  command?: string;
  exitCode?: number | null;
  durationMs?: number;

  evidence?: CheckEvidence[];
}

export interface VerificationComparison {
  checkId: string;

  before: CheckResult;
  after: CheckResult;

  improved: boolean;
}

export interface FixProof {
  status: ProofStatus;

  summary: string;

  comparisons:
    VerificationComparison[];

  regressionChecks:
    CheckResult[];
}

export interface RemediationRun {
  proposal: FixProposal;

  execution:
    FixExecutionResult;

  proof?: FixProof;
}