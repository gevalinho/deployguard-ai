import type { RepositoryScanResult } from "@/lib/scanner/types";
import {
  getNebiusClient,
  NEBIUS_MODELS,
} from "@/lib/ai/nebius";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

// export interface ArchitectureRisk {
//   title: string;
//   severity: RiskSeverity;
//   reason: string;
// }

export interface ArchitectureRisk {
  title: string;
  severity: RiskSeverity;
  reason: string;
  evidenceKeys: string[];
  inference: boolean;
}

export interface ArchitectureAnalysis {
  summary: string;
  architectureType: string;
  recommendedChecks: string[];
  risks: ArchitectureRisk[];
}


export async function runArchitectAgent(
  scan: RepositoryScanResult
): Promise<ArchitectureAnalysis> {
   const nebius = getNebiusClient();

  const response = await nebius.chat.completions.create({
    model: NEBIUS_MODELS.architect,
    temperature: 0.1,

    messages: [
      {
        role: "system",
        content: `
You are the Architect Agent for DeployGuard AI.

Your job is to reason about VERIFIED repository evidence and recommend
production-readiness checks.

IMPORTANT RULES:

1. Treat the supplied repository facts as authoritative.
2. Do not invent technologies that are not supported by the evidence.
3. Do not override or reinterpret verified facts.
4. Clearly distinguish evidence from inference.
5. Recommend checks appropriate for the detected technology stack.
6. Only identify risks reasonably supported by the supplied evidence.
7. Do not claim that a check has passed or failed. You have not executed
   any commands yet.
8. Every risk must reference the repository fact keys that support it
   using evidenceKeys.

9. If a risk requires reasoning beyond the literal evidence,
   set inference to true.

10. Never treat missing evidence as proof that a technology,
    configuration, test suite, or security control is absent.

11. Do not make claims about whether a software version is current,
    outdated, vulnerable, or supported unless that information is
    explicitly present in the supplied evidence.

12. If there is insufficient evidence to support a risk, omit the risk.

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
      "inference": true
    }
  ]
}
        `.trim(),
      },
      {
        role: "user",
        content: `
Analyze these verified repository facts:

${JSON.stringify(scan.facts, null, 2)}
        `.trim(),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("Architect Agent returned no content.");
  }

  return JSON.parse(content) as ArchitectureAnalysis;
}

// export interface ArchitectureRisk {
//   title: string;
//   severity: RiskSeverity;
//   reason: string;
//   evidenceKeys: string[];
//   inference: boolean;
// }