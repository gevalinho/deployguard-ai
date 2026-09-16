import type { ArchitectureAnalysis } from "@/lib/agents/architect-agent";
import type { RemediationAction } from "@/lib/agents/remediation-agent";
import type { CheckResult } from "@/lib/checks/types";
import type { RepositoryScanResult } from "@/lib/scanner/types";
import type { ReadinessScore } from "@/lib/scoring/readiness-score";

export interface RemediationItem {
  category: CheckResult["category"];
  priority: "low" | "medium" | "high";
  title: string;
  recommendation: string;
}

export interface VerifiedAiRemediation {
  summary: string;
  actions: RemediationAction[];
}

export interface ProductionReadinessReport {
  generatedAt: string;

  repository: {
    path: string;
    scannedAt: string;
    facts: RepositoryScanResult["facts"];
  };

  architecture?: ArchitectureAnalysis;

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
  aiRemediation?: VerifiedAiRemediation;
}