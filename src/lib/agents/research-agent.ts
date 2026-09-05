import type {
  RepositoryScanResult,
} from "@/lib/scanner/types";

import {
  researchTopic,
} from "@/lib/research/tavily";

import type {
  ResearchResult,
} from "@/lib/research/types";

export interface ResearchAgentResult {
  queries: string[];
  results: ResearchResult[];
}

function createResearchQueries(
  scan: RepositoryScanResult
): string[] {
  const queries: string[] = [];

  const framework =
    scan.facts.find(
      (fact) =>
        fact.key === "framework"
    );

  const frameworkVersion =
    scan.facts.find(
      (fact) =>
        fact.key ===
        "frameworkVersion"
    );

  if (
    framework?.value &&
    frameworkVersion?.value
  ) {
    queries.push(
      [
        framework.value,
        frameworkVersion.value,
        "current support status",
        "security advisories",
        "official documentation",
      ].join(" ")
    );
  }

  return queries;
}

export async function runResearchAgent(
  scan: RepositoryScanResult
): Promise<ResearchAgentResult> {
  const queries =
    createResearchQueries(scan);

  if (queries.length === 0) {
    return {
      queries: [],
      results: [],
    };
  }

  const results =
    await Promise.all(
      queries.map(
        (query) =>
          researchTopic(query)
      )
    );

  return {
    queries,
    results,
  };
}