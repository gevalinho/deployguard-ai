import { describe, expect, it, vi } from "vitest";
import type { CheckResult } from "@/lib/checks/types";
const audit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/sandbox-security-agent", async (original) => ({
  ...(await original()), runSandboxSecurityAgent: audit,
}));
import { verifyDependencySecurityFix } from "./dependency-security-verifier";

const report = (entries: Array<[string, string, "high" | "critical"]>) => JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: Object.fromEntries(entries.map(([name, id, severity]) =>
    [name, { name, severity, isDirect: true, via: [{ name, severity, source: Number(id) }],
      effects: [], range: "<2", nodes: [`node_modules/${name}`], fixAvailable: true }])),
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0,
    high: entries.filter((entry) => entry[2] === "high").length,
    critical: entries.filter((entry) => entry[2] === "critical").length,
    total: entries.length } },
});
const before: CheckResult = { id: "security", category: "security", name: "audit",
  status: "failed", exitCode: 1, summary: "findings",
  stdout: report([["braces", "123", "high"], ["other", "456", "critical"]]) };
const after = (entries: Array<[string, string, "high" | "critical"]>): CheckResult => ({
  ...before, stdout: report(entries), status: entries.length ? "failed" : "passed",
  exitCode: entries.length ? 1 : 0,
});
const check = (id: string, status: CheckResult["status"] = "passed"): CheckResult =>
  ({ id, category: "build", name: id, status, summary: "" });
const regressions = ["types", "lint", "test", "build"].map((id) => check(id));
const verify = (current: CheckResult, baseline = before, checks = regressions, id = "123") => {
  audit.mockResolvedValue(current);
  return verifyDependencySecurityFix("/repo", baseline, checks, "braces", ["types", "lint", "test", "build"], id);
};

describe("advisory-specific dependency verification", () => {
  it("proves the target with unrelated critical findings remaining", async () => {
    const proof = await verify(after([["other", "456", "critical"]]));
    expect(proof.status).toBe("proven");
    expect(proof.summary).toContain("1 total, 0 high, 1 critical");
  });
  it("proves the target even when the package remains with another advisory", async () => {
    expect((await verify(after([["braces", "789", "high"], ["other", "456", "critical"]]))).status).toBe("proven");
  });
  it("rejects the still-present advisory", async () => {
    expect((await verify(after([["braces", "123", "high"]]))).status).toBe("not_proven");
  });
  it("fails closed when the baseline target is absent or the identity mismatches", async () => {
    expect((await verify(after([]), after([["other", "456", "high"]]))).status).toBe("inconclusive");
    expect((await verify(after([]), before, regressions, "789")).status).toBe("inconclusive");
  });
  it.each(["", "{}", '{"vulnerabilities":{}}', report([["other", "456", "critical"]]).slice(0, -4)])
    ("fails closed on incomplete after audit", async (stdout) => {
      expect((await verify({ ...after([]), stdout })).status).toBe("inconclusive");
    });
  it("fails closed on malformed baseline audit", async () => {
    expect((await verify(after([]), { ...before, stdout: "{}" })).status).toBe("inconclusive");
  });
  it("requires trustworthy after-audit status", async () => {
    expect((await verify({ ...after([["other", "456", "critical"]]), exitCode: 0 })).status).toBe("inconclusive");
  });
  it("rejects failed and unavailable required regressions", async () => {
    expect((await verify(after([]), before, [...regressions.slice(0, 3), check("build", "failed")])).status).toBe("not_proven");
    expect((await verify(after([]), before, [...regressions.slice(0, 3), check("build", "skipped")])).status).toBe("inconclusive");
    expect((await verify(after([]), before, regressions.slice(0, 3))).status).toBe("inconclusive");
  });
});
