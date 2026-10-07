import { describe, expect, it, vi } from "vitest";
import { createArchitectureInput, MAX_RESEARCH_EXCERPT_CHARS, MAX_RESEARCH_TOTAL_CHARS } from "./architecture-input";
import { createRemediationCheckInputs, MAX_REMEDIATION_INPUT_CHARS } from "./remediation-input";
import { emitNemotronTelemetry, runObservedNemotron } from "./nemotron-telemetry";
import type { RepositoryScanResult } from "@/lib/scanner/types";
import type { ResearchAgentResult } from "@/lib/agents/research-agent";
import type { CheckResult } from "@/lib/checks/types";

const scan: RepositoryScanResult = {
  repositoryPath: "/repo", scannedAt: "now",
  facts: [{ key: "environmentVariable", value: "CONFIG_NAME", confidence: 1,
    evidence: Array.from({ length: 8 }, (_, index) => ({ source: "file" as const,
      path: `src/${index}.ts`, description: "repeated evidence secret-marker" })) }],
};

describe("Nemotron request compaction", () => {
  it("preserves facts and one path while eliminating repeated descriptions", () => {
    const input = createArchitectureInput(scan);
    expect(input.facts[0]).toEqual({ key: "environmentVariable", value: "CONFIG_NAME", evidence: ["src/0.ts"] });
    expect(JSON.stringify(input)).not.toContain("secret-marker");
    expect(JSON.stringify(input).length).toBeLessThan(JSON.stringify(scan.facts, null, 2).length / 4);
  });

  it("bounds research excerpts and aggregate research payload", () => {
    const research: ResearchAgentResult = { queries: [], results: [{ query: "q", researchedAt: "now",
      evidence: Array.from({ length: 20 }, (_, index) => ({ topic: "topic", excerpt: "x".repeat(3000),
        source: { title: "title", url: `https://example.com/${index}`, authority: "primary" as const,
          sourceType: "official_documentation" as const } })) }] };
    const items = createArchitectureInput(scan, research).externalResearch;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.excerpt.length <= MAX_RESEARCH_EXCERPT_CHARS)).toBe(true);
    expect(items.reduce((total, item) => total + JSON.stringify(item).length, 0)).toBeLessThanOrEqual(MAX_RESEARCH_TOTAL_CHARS);
    expect(new Set(items.map((item) => item.url)).size).toBe(items.length);
  });

  it("prioritizes failed checks and concrete provenance within aggregate budget", () => {
    const evidence = Array.from({ length: 10 }, (_, index) => ({ kind: "error" as const,
      message: "x".repeat(1500), ...(index === 9 ? { file: "src/broken.ts", line: 12 } : {}) }));
    const checks: CheckResult[] = Array.from({ length: 12 }, (_, index) => ({
      id: `check-${index}`, category: "test" as const, name: "Test", summary: "s".repeat(900),
      status: index === 11 ? "failed" as const : "blocked" as const, evidence,
    }));
    const result = createRemediationCheckInputs(checks);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(MAX_REMEDIATION_INPUT_CHARS);
    expect(result[0].id).toBe("check-11");
    expect(result[0].evidence[0]).toMatchObject({ file: "src/broken.ts", line: 12 });
    expect(result[0].evidence.length).toBeGreaterThan(0);
    expect(result.every((check) => check.id && check.status && Array.isArray(check.evidence))).toBe(true);
  });
});

describe("Nemotron telemetry", () => {
  it("emits only safe metadata", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    emitNemotronTelemetry({ agent: "architecture", model: "model", durationMs: 12,
      requestChars: 50, responseChars: 10, result: "success",
      usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19,
        completion_tokens_details: { reasoning_tokens: 3 } } as never });
    const output = log.mock.calls[0].join(" ");
    expect(output).toContain('"reasoning_tokens":3');
    expect(output).toContain('"result":"success"');
    expect(output).not.toContain("secret-marker");
    expect(Object.keys(JSON.parse(log.mock.calls[0][1]))).toEqual([
      "agent", "model", "durationMs", "requestChars", "prompt_tokens", "completion_tokens",
      "reasoning_tokens", "total_tokens", "finish_reason", "responseChars", "result",
    ]);
    log.mockRestore();
  });

  it("never logs response content on invalid JSON", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(runObservedNemotron({ agent: "remediation", model: "model", requestChars: 10,
      request: async () => ({ choices: [{ message: { content: "private-response-marker" }, finish_reason: "stop" }] }) as never,
      parse: () => { throw new Error("AI response did not contain valid JSON."); },
    })).rejects.toThrow("valid JSON");
    expect(log.mock.calls.flat().join(" ")).not.toContain("private-response-marker");
    expect(log.mock.calls.flat().join(" ")).toContain('"result":"invalid_json"');
    log.mockRestore();
  });
});
