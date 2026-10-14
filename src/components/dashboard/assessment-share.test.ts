import { describe, expect, it, vi } from "vitest";
import type { PublicCheckResult, PublicProductionReadinessReport } from "@/lib/reporting/types";
import { serializeAiContext, serializeFinding, writeShareText, type ShareableAssessment } from "./assessment-share";

function assessment(checks: PublicCheckResult[]): ShareableAssessment {
  return {
    repository: { owner: "owner", name: "repo", fullName: "owner/repo", url: "https://github.com/owner/repo" },
    sourceCommitSha: "a".repeat(40),
    report: { readiness: { score: 72, coverage: 85 } as PublicProductionReadinessReport["readiness"], checks },
  };
}

describe("allowlisted assessment sharing", () => {
  it("exports repository, score, coverage and distinct deterministic statuses", () => {
    const checks: PublicCheckResult[] = (["passed", "failed", "blocked", "skipped", "error"] as const)
      .map((status) => ({ id: status, category: "build", name: "Build", status,
        summary: "secret summary", skipReason: status === "skipped" ? "not_configured" : undefined }));
    const output = serializeAiContext(assessment(checks));
    expect(output).toContain("Repository: owner/repo");
    expect(output).toContain(`Source commit: ${"a".repeat(40)}`);
    expect(output).toContain("Readiness score: 72/100");
    expect(output).toContain("Assessment coverage: 85%");
    for (const status of ["passed", "failed", "blocked", "skipped", "error"]) {
      expect(output).toContain(`: ${status}.`);
    }
    expect(output).toContain("no pass or failure established");
    expect(output).not.toContain("secret summary");
  });

  it("omits free text, commands, paths, outputs, environment values and AI claims", () => {
    const input = assessment([{ id: "security", category: "security", name: "token=private",
      status: "failed", summary: "Authorization: Bearer secret", command: "cat /secrets",
      stdout: "raw secret", stderr: "raw error", configurationRequirements: [{
        variable: "API_KEY", phase: "runtime", reason: "private value" }],
      evidence: [{ kind: "security_finding", message: "file /home/private/config: credential=secret",
        file: "/home/private/config", advisoryIds: ["CVE-2025-12345", "not-safe-token=secret"] }],
    } as PublicCheckResult]);
    const extended = { ...input, report: { ...input.report,
      aiRemediation: { summary: "AI claim", actions: [] },
      repository: { path: "/tmp/private", scannedAt: "", facts: [] } } } as ShareableAssessment;
    const output = serializeAiContext(extended) ?? "";
    expect(output).toContain("Security: failed");
    expect(output).toContain("CVE-2025-12345");
    for (const secret of ["token=private", "Bearer", "cat /secrets", "raw secret", "raw error",
      "API_KEY", "/home/private", "credential=secret", "not-safe-token", "AI claim", "/tmp/private"]) {
      expect(output).not.toContain(secret);
    }
  });

  it("limits checks and advisory identifiers and rejects invalid identities", () => {
    const checks: PublicCheckResult[] = Array.from({ length: 30 }, (_, index) => ({
      id: `check-${index}`, category: "security", name: "Security", status: "failed",
      summary: "sensitive", evidence: [{ kind: "security_finding", message: "sensitive",
        advisoryIds: ["CVE-2025-1234", "CVE-2025-1235", "CVE-2025-1236", "CVE-2025-1237"] }],
    }));
    const input = assessment(checks);
    const output = serializeAiContext(input) ?? "";
    expect(output).toContain("Additional checks omitted.");
    expect(output).not.toContain("21. Security");
    expect(output).not.toContain("CVE-2025-1237");
    expect(output.length).toBeLessThanOrEqual(4000);
    expect(serializeFinding(input, 0)).toContain("Selected verification check:");
    expect(serializeFinding(input, 30)).toBeNull();
    expect(serializeAiContext({ ...input, repository: { ...input.repository, name: "repo\nBearer secret" } })).toBeNull();
  });
});

describe("clipboard behavior", () => {
  it("handles permission failure and unavailable clipboard without throwing", async () => {
    const denied = { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) };
    expect(await writeShareText("safe", denied)).toBe(false);
    expect(await writeShareText("safe", undefined)).toBe(false);
    const allowed = { writeText: vi.fn().mockResolvedValue(undefined) };
    expect(await writeShareText("safe", allowed)).toBe(true);
    expect(allowed.writeText).toHaveBeenCalledWith("safe");
  });
});
