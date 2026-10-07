import { beforeEach, describe, expect, it, vi } from "vitest";
import { architectureResponseFormat, remediationResponseFormat } from "./nemotron-response-schemas";
import { validateArchitectureAnalysis } from "./architecture-validation";
import { validateRemediationAnalysis } from "./remediation-validation";
import { runObservedNemotron } from "./nemotron-telemetry";
import type { RepositoryScanResult } from "@/lib/scanner/types";
import type { CheckResult } from "@/lib/checks/types";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/ai/nebius", () => ({
  NEBIUS_MODELS: { architect: "nvidia/nemotron-3-super-120b-a12b" },
  NEMOTRON_ANALYSIS_TIMEOUT_MS: 20_000,
  NEMOTRON_REMEDIATION_TIMEOUT_MS: 12_000,
  getNebiusClient: () => ({ chat: { completions: { create: mocks.create } } }),
}));

import { runArchitectAgent } from "@/lib/agents/architect-agent";
import { runRemediationAgent } from "@/lib/agents/remediation-agent";

const architecture = {
  summary: "Ready", architectureType: "Next.js", recommendedChecks: ["Run tests"],
  risks: [{ title: "Risk", severity: "medium", reason: "Evidence", evidenceKeys: ["framework"],
    researchUrls: [], inference: false }],
};
const remediation = {
  summary: "Fix tests", actions: [{ title: "Fix test", explanation: "Test failed",
    recommendation: "Inspect failure", priority: "high", checkId: "test", evidenceIndexes: [0] }],
};
const scan: RepositoryScanResult = { repositoryPath: "/repo", scannedAt: "now", facts: [{
  key: "framework", value: "Next.js", confidence: 1,
  evidence: [{ source: "package", path: "package.json", description: "Next.js declared" }],
}] };
const checks: CheckResult[] = [{ id: "test", category: "test", name: "Tests", status: "failed",
  summary: "Tests failed", evidence: [{ kind: "test_failure", message: "Assertion failed", file: "src/test.ts", line: 3 }] }];

beforeEach(() => mocks.create.mockReset());

describe("strict Nemotron response formats", () => {
  it("requests the architecture schema and retains local validation", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(architecture) }, finish_reason: "stop" }] });
    await expect(runArchitectAgent(scan)).resolves.toEqual(architecture);
    const request = mocks.create.mock.calls[0][0];
    expect(request.response_format).toEqual(architectureResponseFormat);
    expect(request.max_tokens).toBeUndefined();
    expect(request.max_completion_tokens).toBeUndefined();
    expect(validateArchitectureAnalysis(architecture)).toEqual(architecture);
    expect(() => validateArchitectureAnalysis({ ...architecture, risks: [{ ...architecture.risks[0], severity: "unsupported" }] })).toThrow();
  });

  it("requests the remediation schema and retains local validation", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(remediation) }, finish_reason: "stop" }] });
    await expect(runRemediationAgent(checks)).resolves.toEqual(remediation);
    const request = mocks.create.mock.calls[0][0];
    expect(request.response_format).toEqual(remediationResponseFormat);
    expect(request.max_tokens).toBeUndefined();
    expect(request.max_completion_tokens).toBeUndefined();
    expect(validateRemediationAnalysis(remediation)).toEqual(remediation);
    expect(() => validateRemediationAnalysis({ ...remediation, actions: [{ ...remediation.actions[0], evidenceIndexes: ["0"] }] })).toThrow();
  });

  it("rejects locally invalid provider output", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: '{"summary":"incomplete"}' }, finish_reason: "stop" }] });
    await expect(runArchitectAgent(scan)).rejects.toThrow("architecture response");
    await expect(runRemediationAgent(checks)).rejects.toThrow("remediation response");
  });

  it("makes length truncation observable without logging content", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(runObservedNemotron({ agent: "architecture", model: "model", requestChars: 8,
      request: async () => ({ choices: [{ message: { content: "private-partial-output" }, finish_reason: "length" }] }) as never,
      parse: () => { throw new Error("must not parse truncated output"); },
    })).rejects.toThrow("ended before completion");
    const output = log.mock.calls.flat().join(" ");
    expect(output).toContain('"finish_reason":"length"');
    expect(output).toContain('"result":"generation_truncated"');
    expect(output).not.toContain("private-partial-output");
    log.mockRestore();
  });

  it("requires exactly the fields accepted by the current validators", () => {
    const a = architectureResponseFormat.json_schema.schema;
    const r = remediationResponseFormat.json_schema.schema;
    expect(a.required).toEqual(Object.keys(a.properties));
    expect(a.additionalProperties).toBe(false);
    expect(a.properties.risks.items.required).toEqual(Object.keys(a.properties.risks.items.properties));
    expect(a.properties.risks.items.additionalProperties).toBe(false);
    expect(r.required).toEqual(Object.keys(r.properties));
    expect(r.additionalProperties).toBe(false);
    expect(r.properties.actions.items.required).toEqual(Object.keys(r.properties.actions.items.properties));
    expect(r.properties.actions.items.additionalProperties).toBe(false);
  });
});
