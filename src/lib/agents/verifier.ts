import type {
  ArchitectureAnalysis,
} from "@/lib/agents/architect-agent";

import type {
  ResearchAgentResult,
} from "@/lib/agents/research-agent";

import type {
  RepositoryScanResult,
} from "@/lib/scanner/types";

export interface VerificationResult {
  acceptedRisks:
    ArchitectureAnalysis["risks"];

  rejectedRisks:
    ArchitectureAnalysis["risks"];
}

export function verifyArchitectureAnalysis(
  scan: RepositoryScanResult,
  analysis: ArchitectureAnalysis,
  research?: ResearchAgentResult
): VerificationResult {
  const knownKeys = new Set(
    scan.facts.map(
      (fact) => fact.key
    )
  );

  const knownResearchUrls =
    new Set(
      research?.results.flatMap(
        (result) =>
          result.evidence.map(
            (item) =>
              item.source.url
          )
      ) ?? []
    );

    const primaryResearchUrls =
  new Set(
    research?.results.flatMap(
      (result) =>
        result.evidence
          .filter(
            (item) =>
              item.source.authority ===
              "primary"
          )
          .map(
            (item) =>
              item.source.url
          )
    ) ?? []
  );

  const acceptedRisks:
    ArchitectureAnalysis["risks"] =
      [];

  const rejectedRisks:
    ArchitectureAnalysis["risks"] =
      [];

  for (
    const risk of analysis.risks
  ) {
    const evidenceKeysAreValid =
      risk.evidenceKeys.length > 0 &&
      risk.evidenceKeys.every(
        (key) =>
          knownKeys.has(key)
      );

    const researchUrlsAreValid =
      risk.researchUrls.every(
        (url) =>
          knownResearchUrls.has(
            url
          )
      );

      const usesExternalResearch =
  risk.researchUrls.length > 0;

const hasPrimaryResearchSupport =
  !usesExternalResearch ||
  risk.researchUrls.some(
    (url) =>
      primaryResearchUrls.has(url)
  );


    /**
     * DeployGuard's verified risk
     * layer only accepts risks
     * directly supported by evidence.
     *
     * AI inference may still be useful
     * for recommendations, but it must
     * not become a verified production
     * risk.
     */
    const isDirectlySupported =
      risk.inference === false;

    if (
  evidenceKeysAreValid &&
  researchUrlsAreValid &&
  hasPrimaryResearchSupport &&
  isDirectlySupported
) {
      acceptedRisks.push(
        risk
      );
    } else {
      rejectedRisks.push(
        risk
      );
    }
  }

  return {
    acceptedRisks,
    rejectedRisks,
  };
}