import type { ArchitectureAnalysis } from "@/lib/agents/architect-agent";
import type { CheckResult } from "@/lib/checks/types";
import type { RepositoryScanResult } from "@/lib/scanner/types";
import type { ReadinessScore } from "@/lib/scoring/readiness-score";

export interface RemediationItem {
  category: CheckResult["category"];
  priority: "low" | "medium" | "high";
  title: string;
  recommendation: string;
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

  remediation: RemediationItem[];
}