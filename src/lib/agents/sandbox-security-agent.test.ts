import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const runSandbox = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", () => ({ runDockerSandboxCommand: runSandbox }));
import { runSandboxSecurityAgent } from "./sandbox-security-agent";
const roots: string[] = [];
afterEach(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); roots.length = 0; runSandbox.mockReset(); });
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
