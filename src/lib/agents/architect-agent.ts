import type { RepositoryScanResult } from "@/lib/scanner/types";
import type { ResearchAgentResult } from "@/lib/agents/research-agent";

import {
  getNebiusClient,
  NEBIUS_MODELS,
} from "@/lib/ai/nebius";

export type RiskSeverity =
  | "low"
  | "medium"
  | "high"
  | "critical";

export interface ArchitectureRisk {
  title: string;
  severity: RiskSeverity;
  reason: string;

  /**
   * Repository fact keys supporting this risk.
   */
  evidenceKeys: string[];

  /**
   * External research URLs supporting time-sensitive
   * or externally verifiable claims.
   */
  researchUrls: string[];

  inference: boolean;
}

export interface ArchitectureAnalysis {
  summary: string;
  architectureType: string;
  recommendedChecks: string[];
  risks: ArchitectureRisk[];
}

export async function runArchitectAgent(
  scan: RepositoryScanResult,
  research?: ResearchAgentResult
): Promise<ArchitectureAnalysis> {
  const nebius =
    getNebiusClient();

  const researchEvidence =
    research?.results.flatMap(
      (result) =>
        result.evidence.map(
          (item) => ({
            topic: item.topic,
            excerpt: item.excerpt,
            relevanceScore:
              item.relevanceScore,
            source: {
              title:
                item.source.title,
              url:
                item.source.url,
              sourceType:
                item.source.sourceType,
              authority:
                item.source.authority,
              publisher:
                item.source.publisher,
              publishedAt:
                item.source.publishedAt,
            },
          })
        )
    ) ?? [];

  const response =
    await nebius.chat.completions.create({
      model:
        NEBIUS_MODELS.architect,
      temperature: 0.1,

      messages: [
        {
          role: "system",
          content: `
You are the Architect Agent for DeployGuard AI.

Your job is to reason about VERIFIED repository evidence and,
when supplied, external research evidence, then recommend
production-readiness checks.

IMPORTANT RULES:

1. Treat the supplied repository facts as authoritative for what
   exists in the repository.

2. External research does NOT override repository facts.

3. Do not invent technologies that are not supported by repository
   evidence.

4. Do not override or reinterpret verified repository facts.

5. Clearly distinguish repository evidence, external evidence,
   and inference.

6. Recommend checks appropriate for the detected technology stack.

7. Only identify risks reasonably supported by the supplied evidence.

8. Do not claim that an executable repository check has passed or
   failed. You have not executed those commands.

9. Every repository-supported risk must reference the relevant
   repository fact keys using evidenceKeys.

10. Every externally supported claim about software support,
    releases, security advisories, or current guidance must reference
    the supporting source URLs using researchUrls.

11. If a risk requires reasoning beyond the literal evidence,
    set inference to true.

12. Never treat missing evidence as proof that a technology,
    configuration, test suite, or security control is absent.

13. Do not make claims about whether a software version is current,
    outdated, vulnerable, patched, or supported unless external
    research evidence explicitly supports the claim.

14. A search result's relevanceScore measures search relevance.
    It is NOT a factual confidence score.

15. Prefer primary sources over secondary or community sources
    when they conflict.

16. Do not treat an external research excerpt as automatically true.
    Evaluate it according to its source authority and whether it
    actually supports the claim.

17. Do not claim that the repository is affected by a vulnerability
    merely because an advisory exists. The repository version and
    advisory evidence must support that conclusion.

18. If external evidence is insufficient or conflicting, omit the
    claim rather than guessing.

19. If no external research evidence is supplied, do not make
    time-sensitive claims.

20. Cite only the research URLs that directly support the specific claim.
    Do not cite every supplied research source.

21. When primary-source evidence directly supports a claim, prefer it
    and avoid unnecessary secondary or community citations.

22. A hypothetical condition is not a current repository risk.
    For example, if the detected version is already patched, do not
    create a risk describing what would happen if an older version
    were installed.

23. Risks must describe a condition supported as currently present
    in the analyzed repository. Historical vulnerabilities that are
    already patched in the detected version may be mentioned in the
    summary or recommendations, but must not be reported as current risks.    

Return ONLY valid JSON with this exact structure:

{
  "summary": "string",
  "architectureType": "string",
  "recommendedChecks": ["string"],
  "risks": [
    {
      "title": "string",
      "severity": "low | medium | high | critical",
      "reason": "string",
      "evidenceKeys": ["string"],
      "researchUrls": ["string"],
      "inference": true
    }
  ]
}
          `.trim(),
        },

        {
          role: "user",
          content: `
Analyze the following evidence.

VERIFIED REPOSITORY FACTS:

${JSON.stringify(
  scan.facts,
  null,
  2
)}

EXTERNAL RESEARCH EVIDENCE:

${JSON.stringify(
  researchEvidence,
  null,
  2
)}
          `.trim(),
        },
      ],
    });

  const content =
    response.choices[0]
      ?.message?.content;

  if (!content) {
    throw new Error(
      "Architect Agent returned no content."
    );
  }

  return JSON.parse(
    content
  ) as ArchitectureAnalysis;
}