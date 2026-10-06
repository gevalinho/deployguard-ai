import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateReadinessScore } from "@/lib/scoring/readiness-score";
import type { CheckResult } from "@/lib/checks/types";

const ai = vi.hoisted(() => ({ architect: vi.fn(), remediation: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/lib/repository/repository-ingestion", () => ({ ingestGitHubRepository: async (repository: unknown) => ({
  repository, repositoryPath: "/temporary/repository", provenance: { source: "verified-cache", remoteVerified: true },
  cleanup: ai.cleanup,
}) }));
vi.mock("@/lib/scanner/repository-scanner", () => ({ scanRepository: async () => ({
  repositoryPath: "/temporary/repository", scannedAt: "2026-01-01T00:00:00.000Z", facts: [],
}) }));
vi.mock("@/lib/agents/research-agent", () => ({ runResearchAgent: async () => ({ queries: [], results: [] }) }));
vi.mock("@/lib/sandbox/workspace-preparation", () => ({ prepareSandboxWorkspace: async () => ({ status: "passed", summary: "Prepared" }) }));
vi.mock("@/lib/agents/architect-agent", () => ({ runArchitectAgent: ai.architect }));
vi.mock("@/lib/agents/remediation-agent", () => ({ runRemediationAgent: ai.remediation }));
vi.mock("@/lib/agents/environment-agent", () => ({ runEnvironmentAgent: async () => checks[0] }));
vi.mock("@/lib/agents/deployment-agent", () => ({ runDeploymentAgent: async () => checks[1] }));
vi.mock("@/lib/agents/sandbox-typecheck-agent", () => ({ runSandboxTypecheckAgent: async () => checks[2] }));
vi.mock("@/lib/agents/sandbox-lint-agent", () => ({ runSandboxLintAgent: async () => checks[3] }));
vi.mock("@/lib/agents/sandbox-test-agent", () => ({ runSandboxTestAgent: async () => checks[4] }));
vi.mock("@/lib/agents/sandbox-build-agent", () => ({ runSandboxBuildAgent: async () => checks[5] }));
vi.mock("@/lib/agents/sandbox-security-agent", () => ({ runSandboxSecurityAgent: async () => checks[6] }));

import { runRemoteReadinessAssessment } from "../remote-readiness-orchestrator";
import type { AssessmentProgressEvent } from "../assessment-progress";

const checks: CheckResult[] = [
  { id: "environment", category: "environment", name: "Environment", status: "skipped", skipReason: "not_configured", summary: "Not configured" },
  { id: "deployment", category: "deployment", name: "Deployment", status: "skipped", skipReason: "not_configured", summary: "Not configured" },
  { id: "types", category: "types", name: "TypeScript", status: "passed", summary: "Passed" },
  { id: "lint", category: "lint", name: "Lint", status: "passed", summary: "Passed" },
  { id: "test", category: "test", name: "Tests", status: "failed", summary: "Failed" },
  { id: "build", category: "build", name: "Build", status: "passed", summary: "Passed" },
  { id: "security", category: "security", name: "Security", status: "failed", summary: "Failed" },
];

afterEach(() => { vi.useRealTimers(); ai.architect.mockReset(); ai.remediation.mockReset(); ai.cleanup.mockReset(); });

describe("assessment AI fail-soft boundary", () => {
  it("returns the deterministic report after malformed analysis and remediation timeout", async () => {
    vi.useFakeTimers();
    ai.architect.mockRejectedValue(new Error("AI response did not contain valid JSON."));
    ai.remediation.mockImplementation(() => new Promise(() => {}));
    const progress: AssessmentProgressEvent[] = [];
    const resultPromise = runRemoteReadinessAssessment("https://github.com/owner/repo", {
      onProgress: (event) => { progress.push(event); },
    });
    const assertion = expect(resultPromise).resolves.toBeDefined();
    await vi.advanceTimersByTimeAsync(12_100);
    await assertion;
    const result = await resultPromise;
    const baseline = calculateReadinessScore(checks);
    expect(result.report.readiness.score).toBe(baseline.score);
    expect(result.report.readiness.coverage).toBe(baseline.coverage);
    expect(result.report.architecture).toBeUndefined();
    expect(result.report.aiRemediation).toBeUndefined();
    expect(result.report.aiAvailability).toEqual({ architecture: "unavailable", remediation: "unavailable" });
    expect(progress).toContainEqual(expect.objectContaining({ stage: "report", status: "completed" }));
    expect(progress).toContainEqual(expect.objectContaining({ stage: "remediation", status: "error" }));
    expect(ai.cleanup).toHaveBeenCalledOnce();
  });

  it("returns the same score after analysis timeout and provider failure", async () => {
    vi.useFakeTimers();
    ai.architect.mockImplementation(() => new Promise(() => {}));
    ai.remediation.mockRejectedValue(new Error("Provider network failure"));
    const resultPromise = runRemoteReadinessAssessment("https://github.com/owner/repo");
    const assertion = expect(resultPromise).resolves.toBeDefined();
    await vi.advanceTimersByTimeAsync(20_100);
    await assertion;
    const result = await resultPromise;
    const baseline = calculateReadinessScore(checks);
    expect(result.report.readiness).toEqual(baseline);
    expect(result.report.aiAvailability).toEqual({ architecture: "unavailable", remediation: "unavailable" });
  });
});
