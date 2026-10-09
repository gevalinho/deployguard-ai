import { describe, expect, it, vi } from "vitest";
import type { CheckResult } from "@/lib/checks/types";
const audit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/sandbox-security-agent", async (original) => ({
  ...(await original()), runSandboxSecurityAgent: audit,
}));
import { verifyDependencySecurityFix } from "./dependency-security-verifier";

const report = (names: string[]) => JSON.stringify({
  vulnerabilities: Object.fromEntries(names.map((name) => [name, { name, severity: "high" }])),
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0,
    high: names.length, critical: 0, total: names.length } },
});
const before: CheckResult = {
  id: "security", category: "security", name: "audit", status: "failed",
  summary: "findings", stdout: report(["target", "other"]),
};

describe("dependency audit verification", () => {
  it("reports partial remediation when fewer findings remain", async () => {
    audit.mockResolvedValue({ ...before, stdout: report(["other"]) });
    const proof = await verifyDependencySecurityFix("/repo", before, [], "target");
    expect(proof.status).toBe("not_proven");
    expect(proof.summary).toContain("Partial remediation");
  });

  it("requires the targeted package to disappear from the after audit", async () => {
    audit.mockResolvedValue({ ...before, status: "passed", stdout: report(["target"]) });
    const proof = await verifyDependencySecurityFix("/repo", before, [], "target");
    expect(proof.status).toBe("inconclusive");
  });

  it("proves a resolved target only when the whole audit passes", async () => {
    audit.mockResolvedValue({ ...before, status: "passed", stdout: report([]) });
    const proof = await verifyDependencySecurityFix("/repo", before, [], "target");
    expect(proof.status).toBe("proven");
  });

  it.each(["", "{}", '{"vulnerabilities":{}}'])("fails closed on incomplete after-audit evidence", async (stdout) => {
    audit.mockResolvedValue({ ...before, status: "passed", stdout });
    expect((await verifyDependencySecurityFix("/repo", before, [], "target")).status).toBe("inconclusive");
  });

  it.each(["blocked", "error", "skipped"] as const)("does not prove with a %s required regression", async (status) => {
    audit.mockResolvedValue({ ...before, status: "passed", stdout: report([]) });
    const check: CheckResult = { id: "build", category: "build", name: "build", status, summary: "" };
    expect((await verifyDependencySecurityFix("/repo", before, [check], "target")).status).toBe("inconclusive");
  });

  it("allows a documented optional skip and passing required regression", async () => {
    audit.mockResolvedValue({ ...before, status: "passed", stdout: report([]) });
    const checks: CheckResult[] = [
      { id: "test", category: "test", name: "test", status: "skipped", skipReason: "not_configured", summary: "" },
      { id: "build", category: "build", name: "build", status: "passed", summary: "" },
    ];
    expect((await verifyDependencySecurityFix("/repo", before, checks, "target")).status).toBe("proven");
  });

  it("rejects a failed required regression", async () => {
    audit.mockResolvedValue({ ...before, status: "passed", stdout: report([]) });
    const check: CheckResult = { id: "build", category: "build", name: "build", status: "failed", summary: "" };
    expect((await verifyDependencySecurityFix("/repo", before, [check], "target")).status).toBe("not_proven");
  });
  it("fails closed when a required regression result is missing", async () => {
    audit.mockResolvedValue({ ...before, status: "passed", stdout: report([]) });
    const check: CheckResult = { id: "build", category: "build", name: "build", status: "passed", summary: "" };
    const proof = await verifyDependencySecurityFix("/repo", before, [check], "target", ["build", "test"]);
    expect(proof.status).toBe("inconclusive");
  });
});
