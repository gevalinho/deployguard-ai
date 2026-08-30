import type { ArchitectureAnalysis } from "@/lib/agents/architect-agent";
import type { RepositoryScanResult } from "@/lib/scanner/types";

export interface VerificationResult {
  acceptedRisks: ArchitectureAnalysis["risks"];
  rejectedRisks: ArchitectureAnalysis["risks"];
}

export function verifyArchitectureAnalysis(
  scan: RepositoryScanResult,
  analysis: ArchitectureAnalysis
): VerificationResult {
  const knownKeys = new Set(scan.facts.map((fact) => fact.key));

  const acceptedRisks: ArchitectureAnalysis["risks"] = [];
  const rejectedRisks: ArchitectureAnalysis["risks"] = [];

  for (const risk of analysis.risks) {
    const evidenceIsValid =
      risk.evidenceKeys.length > 0 &&
      risk.evidenceKeys.every((key) => knownKeys.has(key));

    if (evidenceIsValid) {
      acceptedRisks.push(risk);
    } else {
      rejectedRisks.push(risk);
    }
  }

  return {
    acceptedRisks,
    rejectedRisks,
  };
}