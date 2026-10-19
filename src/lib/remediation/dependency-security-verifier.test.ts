import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckResult } from "@/lib/checks/types";
const audit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/sandbox-security-agent", async (original) => ({
  ...(await original()), runSandboxSecurityAgent: audit,
}));
import { verifyDependencySecurityFix } from "./dependency-security-verifier";
import { runSandboxBuildAgent } from "@/lib/agents/sandbox-build-agent";

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
  ({ id, category: id as CheckResult["category"], name: id, status,
    exitCode: status === "passed" ? 0 : null,
    ...(id === "test" && status === "passed" ? { testExecutionVerified: true } : {}), summary: "" });
const regressions = ["types", "lint", "test", "build"].map((id) => check(id));
let defaultRoot: string;
beforeAll(() => {
  defaultRoot = mkdtempSync(join(tmpdir(), "deployguard-proof-default-"));
  writeFileSync(join(defaultRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  writeFileSync(join(defaultRoot, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }));
  mkdirSync(join(defaultRoot, "test"));
  writeFileSync(join(defaultRoot, "test", "suite.test.js"), `const test = require('node:test');
    for (let index = 0; index < 4; index++) test('case ' + index, () => {});`);
});
afterAll(() => rmSync(defaultRoot, { recursive: true, force: true }));
const verify = (current: CheckResult, baseline = before, checks = regressions, id = "123") => {
  audit.mockResolvedValue(current);
  return verifyDependencySecurityFix(defaultRoot, baseline, checks, "braces", ["types", "lint", "test", "build"], id);
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
    expect((await verify(after([]), before, [...regressions, check("other")])).status).toBe("inconclusive");
    expect((await verify(after([]), before, [...regressions.slice(0, 3), { ...check("build"), category: "test" }])).status).toBe("inconclusive");
    audit.mockResolvedValue(after([]));
    expect((await verifyDependencySecurityFix(defaultRoot, before, [], "braces", [], "123")).status).toBe("inconclusive");
    expect((await verifyDependencySecurityFix(defaultRoot, before, regressions.slice(0, 3), "braces", [], "123")).status).toBe("inconclusive");
  });
  it("requires runner-observed tests even with a zero exit code", async () => {
    const checks = regressions.map((item) => item.id === "test"
      ? { ...item, testExecutionVerified: undefined } : item);
    expect((await verify(after([]), before, checks)).status).toBe("inconclusive");
  });
  it("proves the actual dependency-only fixture shape with a passing test", async () => {
    const root = mkdtempSync(join(tmpdir(), "deployguard-proof-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "deployguard-vulnerable-fixture",
        version: "1.0.0", private: true, scripts: { test: "node --test" },
        dependencies: { lodash: "4.17.20" } }));
      writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }));
      mkdirSync(join(root, "test"));
      writeFileSync(join(root, "test", "lodash.test.js"), `const test = require('node:test');
        for (let index = 0; index < 4; index++) test('case ' + index, () => {});`);
      audit.mockResolvedValue(after([]));
      const checks = [
        { ...check("types", "skipped"), skipReason: "not_applicable" as const },
        { ...check("lint", "skipped"), skipReason: "not_configured" as const },
        check("test"),
        { ...check("build", "skipped"), skipReason: "not_applicable" as const },
      ];
      const prove = (candidate = checks) => verifyDependencySecurityFix(root, before, candidate,
        "braces", ["types", "lint", "test", "build"], "123");
      expect(await runSandboxBuildAgent(root)).toMatchObject({ status: "skipped", skipReason: "not_applicable" });
      expect((await prove()).status).toBe("proven");
      expect((await prove(checks.map((check) => check.id === "test" ? { ...check, exitCode: null } : check))).status).toBe("inconclusive");
      expect((await prove(checks.map((check) => check.id === "build" ? { ...check, skipReason: "unsupported" } : check))).status).toBe("inconclusive");
      expect((await prove([...checks, check("build")])).status).toBe("inconclusive");
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "index.js"), "module.exports = {};");
      expect(await runSandboxBuildAgent(root)).toMatchObject({ status: "skipped", skipReason: "not_configured" });
      expect((await prove()).status).toBe("inconclusive");
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0",
        private: true, dependencies: { lodash: "4.17.20" }, scripts: {} }));
      expect((await prove()).status).toBe("inconclusive");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("does not prove a missing build in an application", async () => {
    const root = mkdtempSync(join(tmpdir(), "deployguard-proof-app-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app", version: "1.0.0",
        dependencies: { react: "*", vite: "*" }, scripts: { test: "node --test" } }));
      writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }));
      audit.mockResolvedValue(after([]));
      const checks = [check("types"), check("lint"), check("test"),
        { ...check("build", "skipped"), skipReason: "not_configured" as const }];
      expect((await verifyDependencySecurityFix(root, before, checks, "braces",
        ["types", "lint", "test", "build"], "123")).status).toBe("inconclusive");
      expect(await runSandboxBuildAgent(root)).toMatchObject({ status: "skipped", skipReason: "not_configured" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
