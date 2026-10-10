import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const runSandbox = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", () => ({ runDockerSandboxCommand: runSandbox }));
import { runSandboxSecurityAgent } from "./sandbox-security-agent";
import { sanitizeCheckForPublic } from "@/lib/reporting/public-report";
const roots: string[] = [];
afterEach(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); roots.length = 0; runSandbox.mockReset(); vi.restoreAllMocks(); });
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "dg-audit-evidence-"));
  roots.push(root);
  await writeFile(join(root, "package-lock.json"), "{}");
  return root;
}
const report = (high: number) => JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: high ? { target: { name: "target", severity: "high", isDirect: true,
    via: [{ name: "target", severity: "high", source: 9876 }], effects: [], range: "<2", nodes: ["node_modules/target"], fixAvailable: true } } : {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical: 0, total: high } },
});
describe("sandbox security audit result", () => {
  it.each(["", "{}", '{"vulnerabilities":{'])("rejects incomplete output", async (stdout) => {
    runSandbox.mockResolvedValue({ status: "passed", exitCode: 0, stdout, stderr: "", durationMs: 1 });
    expect((await runSandboxSecurityAgent(await repository())).status).toBe("error");
  });
  it("rejects a failed sandbox run with missing audit stdout", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    runSandbox.mockResolvedValue({ status: "failed", exitCode: 1, stdout: "", stderr: "npm failed", durationMs: 1 });
    const result = await runSandboxSecurityAgent(await repository());
    expect(result.status).toBe("error");
    expect(result.evidence).toBeUndefined();
    expect(warning).toHaveBeenCalledWith("[DeployGuard Dependency Audit Diagnostic]",
      expect.objectContaining({ reason: "empty_stdout", stdoutBytes: 0, jsonParsed: false }));
    expect(JSON.stringify(warning.mock.calls)).not.toContain("npm failed");
  });
  it("logs only safe structural metadata for malformed npm output", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stdout = JSON.stringify({ auditReportVersion: 2, vulnerabilities: {
      secret: { name: "secret", via: [{ title: "private title", url: "https://private.example" }] } },
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } } });
    runSandbox.mockResolvedValue({ status: "failed", exitCode: 1, stdout, stderr: "private stderr", durationMs: 1 });
    expect((await runSandboxSecurityAgent(await repository())).status).toBe("error");
    expect(warning).toHaveBeenCalledWith("[DeployGuard Dependency Audit Diagnostic]",
      expect.objectContaining({ reason: "invalid_vulnerability_records", stdoutBytes: Buffer.byteLength(stdout),
        jsonParsed: true, auditReportVersion: 2 }));
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toMatch(/secret|private|https:|stderr|stdout\":/);
  });
  it("logs a fixed reciprocal-link subreason without package names", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stdout = JSON.stringify({ auditReportVersion: 2, vulnerabilities: {
      dependency: { name: "dependency", severity: "high", isDirect: false,
        via: [{ name: "dependency", severity: "high", source: 9876 }], effects: ["dependent"],
        range: "<2", nodes: ["node_modules/dependency"], fixAvailable: true },
      dependent: { name: "dependent", severity: "high", isDirect: true,
        via: [{ name: "dependent", severity: "high", source: 9877 }],
        effects: [], range: "<2", nodes: ["node_modules/dependent"], fixAvailable: true },
    }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 } } });
    runSandbox.mockResolvedValue({ status: "failed", exitCode: 1, stdout, stderr: "", durationMs: 1 });
    expect((await runSandboxSecurityAgent(await repository())).status).toBe("error");
    expect(warning).toHaveBeenCalledWith("[DeployGuard Dependency Audit Diagnostic]",
      expect.objectContaining({ reason: "inconsistent_vulnerability_relationships",
        relationshipSubreason: "reciprocal_link_failure", missingReverseEffectsCount: 0,
        missingReverseStringViaCount: 1, absentViaReferenceCount: 0, absentEffectReferenceCount: 0 }));
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/dependency|dependent|node_modules/);
  });
  it("logs safe counters when a one-sided npm relationship is accepted", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stdout = JSON.stringify({ auditReportVersion: 2, vulnerabilities: {
      source: { name: "source", severity: "high", isDirect: true,
        via: [{ name: "source", severity: "high", source: 9876 }], effects: [],
        range: "<2", nodes: ["node_modules/source"], fixAvailable: true },
      dependent: { name: "dependent", severity: "high", isDirect: false,
        via: ["source"], effects: [], range: "<2",
        nodes: ["node_modules/dependent"], fixAvailable: true },
    }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2,
      critical: 0, total: 2 } } });
    runSandbox.mockResolvedValue({ status: "failed", exitCode: 1, stdout, stderr: "", durationMs: 1 });
    const result = await runSandboxSecurityAgent(await repository());
    expect(result.status).toBe("failed");
    expect(result.evidence).toBeDefined();
    expect(warning).toHaveBeenCalledWith("[DeployGuard Dependency Audit Diagnostic]",
      expect.objectContaining({ reason: null, missingReverseEffectsCount: 1,
        missingReverseStringViaCount: 0, absentViaReferenceCount: 0,
        absentEffectReferenceCount: 0 }));
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/"source"|"dependent"|node_modules/);
    expect(JSON.stringify(sanitizeCheckForPublic(result))).not.toContain("missingReverseEffectsCount");
  });
  it("classifies unusable sandbox execution status", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    runSandbox.mockResolvedValue({ status: "failed", exitCode: null, stdout: report(0), stderr: "", durationMs: 1 });
    expect((await runSandboxSecurityAgent(await repository())).status).toBe("error");
    expect(warning).toHaveBeenCalledWith("[DeployGuard Dependency Audit Diagnostic]",
      expect.objectContaining({ reason: "sandbox_execution_failure", jsonParsed: true }));
  });
  it("classifies an audit sandbox timeout without logging command output", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    runSandbox.mockResolvedValue({ status: "timed_out", exitCode: null,
      stdout: "private stdout", stderr: "private stderr", durationMs: 30_000 });
    expect((await runSandboxSecurityAgent(await repository())).status).toBe("blocked");
    expect(warning).toHaveBeenCalledWith("[DeployGuard Dependency Audit Diagnostic]",
      expect.objectContaining({ reason: "sandbox_execution_failure" }));
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private");
  });
  it("logs registry failure without changing the blocked result or exposing stderr", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    runSandbox.mockResolvedValue({ status: "failed", exitCode: 1, stdout: "",
      stderr: "ENOTFOUND private-registry.example token=private-secret", durationMs: 1 });
    const result = await runSandboxSecurityAgent(await repository());
    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("registry or audit service was unavailable");
    expect(warning).toHaveBeenCalledWith("[DeployGuard Dependency Audit Diagnostic]",
      expect.objectContaining({ reason: "audit_service_unavailable", stdoutBytes: 0,
        jsonParsed: false, sandboxStatus: "failed", exitCode: 1 }));
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/private|ENOTFOUND|token=/);
    expect(JSON.stringify(sanitizeCheckForPublic(result))).not.toMatch(/private|ENOTFOUND|token=|audit_service_unavailable/);
  });
  it("logs a complete audit with unsuccessful exit and no high-risk finding", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    runSandbox.mockResolvedValue({ status: "failed", exitCode: 1, stdout: report(0),
      stderr: "private command detail", durationMs: 1 });
    const result = await runSandboxSecurityAgent(await repository());
    expect(result.status).toBe("error");
    expect(result.summary).toBe("Dependency audit exited unsuccessfully without matching high-risk findings.");
    expect(warning).toHaveBeenCalledWith("[DeployGuard Dependency Audit Diagnostic]",
      expect.objectContaining({ reason: "audit_exit_without_high_severity", jsonParsed: true,
        counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } }));
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private command detail");
    expect(JSON.stringify(sanitizeCheckForPublic(result))).not.toContain("audit_exit_without_high_severity");
  });
  it("logs a thrown sandbox failure without logging or changing its sensitive exception", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new Error("private repository path and token=private-secret");
    runSandbox.mockRejectedValue(failure);
    await expect(runSandboxSecurityAgent(await repository())).rejects.toBe(failure);
    expect(warning).toHaveBeenCalledWith("[DeployGuard Dependency Audit Diagnostic]",
      expect.objectContaining({ reason: "sandbox_execution_failure", sandboxStatus: "threw",
        exitCode: null, stdoutBytes: 0 }));
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/private|token=|repository path/);
  });
  it("accepts a complete zero-vulnerability report", async () => {
    runSandbox.mockResolvedValue({ status: "passed", exitCode: 0, stdout: report(0), stderr: "", durationMs: 1 });
    expect((await runSandboxSecurityAgent(await repository())).status).toBe("passed");
  });
  it("does not accept an unavailable audit exit status", async () => {
    runSandbox.mockResolvedValue({ status: "failed", exitCode: null, stdout: report(0), stderr: "", durationMs: 1 });
    expect((await runSandboxSecurityAgent(await repository())).status).toBe("error");
  });
  it("retains findings when npm exits with vulnerabilities", async () => {
    runSandbox.mockResolvedValue({ status: "failed", exitCode: 1, stdout: report(1), stderr: "", durationMs: 1 });
    const result = await runSandboxSecurityAgent(await repository());
    expect(result.status).toBe("failed");
    expect(result.evidence?.[0].message).toContain("target");
    expect(result.evidence?.[0].advisoryIds).toEqual(["9876"]);
  });
  it("accepts a complete pnpm-style advisory report", async () => {
    const root = await repository();
    await rm(join(root, "package-lock.json"));
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    runSandbox.mockResolvedValue({ status: "failed", exitCode: 1,
      stdout: JSON.stringify({ advisories: { "123": { module_name: "target", severity: "high" } },
        metadata: { vulnerabilities: { high: 1, critical: 0 } } }),
      stderr: "", durationMs: 1 });
    expect((await runSandboxSecurityAgent(root)).status).toBe("failed");
  });
});
