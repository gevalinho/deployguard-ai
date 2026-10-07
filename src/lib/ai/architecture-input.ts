import type { RepositoryScanResult } from "@/lib/scanner/types";
import type { ResearchAgentResult } from "@/lib/agents/research-agent";

export const MAX_RESEARCH_EXCERPT_CHARS = 600;
export const MAX_RESEARCH_TOTAL_CHARS = 4_000;

export function createArchitectureInput(scan: RepositoryScanResult, research?: ResearchAgentResult) {
  const facts = scan.facts.map((fact) => {
    const paths = [...new Set(fact.evidence.map((item) => item.path))]
      .slice(0, fact.key === "environmentVariable" ? 1 : 3);
    return {
      key: fact.key,
      value: fact.value,
      ...(fact.confidence !== 1 ? { confidence: fact.confidence } : {}),
      evidence: paths,
    };
  });

  const externalResearch: Array<{
    topic: string; excerpt: string; url: string; title: string;
    authority: string; sourceType: string; publishedAt?: string;
  }> = [];
  let used = 0;
  const seen = new Set<string>();
  for (const result of research?.results ?? []) {
    for (const item of result.evidence) {
      if (seen.has(item.source.url) || used >= MAX_RESEARCH_TOTAL_CHARS) continue;
      const available = MAX_RESEARCH_TOTAL_CHARS - used;
      const excerpt = item.excerpt.slice(0, Math.min(MAX_RESEARCH_EXCERPT_CHARS, available));
      if (!excerpt) continue;
      const entry = {
        topic: item.topic.slice(0, 120), excerpt,
        url: item.source.url, title: item.source.title.slice(0, 120),
        authority: item.source.authority, sourceType: item.source.sourceType,
        ...(item.source.publishedAt ? { publishedAt: item.source.publishedAt } : {}),
      };
      const cost = JSON.stringify(entry).length;
      if (used + cost + 1 > MAX_RESEARCH_TOTAL_CHARS) continue;
      seen.add(item.source.url);
      used += cost + 1;
      externalResearch.push(entry);
    }
  }
  return { facts, externalResearch };
}
