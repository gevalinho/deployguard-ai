import type {
  ArchitectureAnalysis,
} from "@/lib/agents/architect-agent";

import type {
  RemediationAction,
} from "@/lib/agents/remediation-agent";

import type {
  CheckResult,
} from "@/lib/checks/types";

import type {
  RepositoryScanResult,
} from "@/lib/scanner/types";

import type {
  ReadinessScore,
} from "@/lib/scoring/readiness-score";

export interface RemediationItem {
  category: CheckResult["category"];
  priority:
    | "low"
    | "medium"
    | "high";
  title: string;
  recommendation: string;
}

export interface VerifiedAiRemediation {
  summary: string;
  actions: RemediationAction[];
}

/*
 * Internal report.
 *
 * CheckResult may contain raw stdout/stderr required
 * for server-side diagnostics and processing.
 */
export interface ProductionReadinessReport {
  generatedAt: string;

  repository: {
    path: string;
    scannedAt: string;
    facts:
      RepositoryScanResult["facts"];
  };

  architecture?:
    ArchitectureAnalysis;

  checks: CheckResult[];

  readiness: ReadinessScore;

  /*
   * Deterministic remediation generated directly
   * from verified check outcomes and evidence.
   */
  remediation: RemediationItem[];

  /*
   * Optional Nemotron remediation.
   *
   * Only actions accepted by the deterministic
   * remediation verifier may appear here.
   *
   * AI remediation never participates in readiness
   * score calculation.
   */
  aiRemediation?:
    VerifiedAiRemediation;
}

/*
 * Public check contract.
 *
 * Raw stdout and stderr deliberately do not exist
 * on this type and therefore cannot cross the
 * browser/API boundary through a typed response.
 */
export type PublicCheckResult =
  Omit<
    CheckResult,
    "stdout" | "stderr"
  >;

/*
 * Public readiness report.
 *
 * Everything is inherited from the internal report
 * except checks, which are replaced with the
 * explicitly safe public representation.
 */
export type PublicProductionReadinessReport =
  Omit<
    ProductionReadinessReport,
    "checks"
  > & {
    checks: PublicCheckResult[];
  };