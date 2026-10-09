import { mkdtemp, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const runSandbox = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", () => ({
  runDockerSandboxCommand: runSandbox,
  SandboxContainerStateUnknownError: class extends Error {},
}));
import { applyDependencySecurityFix } from "./dependency-security-fixer";

const repositories: string[] = [];
const cacheRoots: string[] = [];
const originalCacheRoot = process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT;
afterEach(async () => {
  for (const path of repositories) await rm(path, { recursive: true, force: true });
  for (const path of cacheRoots) await rm(path, { recursive: true, force: true });
  repositories.length = 0;
  cacheRoots.length = 0;
  if (originalCacheRoot === undefined) delete process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT;
  else process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT = originalCacheRoot;
  runSandbox.mockReset();
});
async function repository() {
  const cacheRoot = await mkdtemp(join(process.cwd(), ".deployguard-cache-test-"));
  cacheRoots.push(cacheRoot);
  process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT = cacheRoot;
  const path = await mkdtemp(join(tmpdir(), "deployguard-fixer-test-"));
  repositories.push(path);
  await writeFile(join(path, "package-lock.json"), "{}");
  return path;
}
const proposal = {
  id: "test", title: "test", description: "test",
  target: { checkId: "test", category: "security", evidenceIndexes: [] },
  strategy: "dependency_security", risk: "breaking_change_allowed",
} as Parameters<typeof applyDependencySecurityFix>[1];
const report = (value: object) => `DEPLOYGUARD_CACHE_PREFLIGHT:${JSON.stringify(value)}\n`;

describe("dependency cache preflight", () => {
  it("uses the same private mount, user and limits as npm and cleans up", async () => {
    const path = await repository();
    let cachePath = "";
    runSandbox.mockImplementation(async (input) => {
      cachePath = input.mounts[0].source;
      expect(cachePath.startsWith(cacheRoots[0] + "/deployguard-npm-cache-")).toBe(true);
      expect(cachePath.startsWith("/tmp/")).toBe(false);
      expect(input.mounts[0]).toMatchObject({ target: "/tmp/npm-cache", selinuxPrivate: true });
      expect(input.command.slice(0, 2)).toEqual(["node", "-e"]);
      expect(input.command.slice(5)).toEqual(["audit", "fix", "--force", "--ignore-scripts", "--no-audit", "--no-fund"]);
      expect(input.command.slice(3, 5)).toEqual(input.user.split(":"));
      expect(input.command[2]).toContain('cp.spawnSync("npm"');
      expect(input.user).toMatch(/^[1-9]\d*:\d+$/);
      expect(input.limits).toEqual({ memoryMb: 2048, cpus: 1, timeoutMs: 120_000 });
      expect((await stat(cachePath)).mode & 0o777).toBe(0o700);
      return { status: "passed", exitCode: 0, stdout: report({ uid: 1000, gid: 1000, context: "container_t", ok: true }), stderr: "", durationMs: 1 };
    });
    expect((await applyDependencySecurityFix(path, proposal)).status).toBe("applied");
    expect(runSandbox).toHaveBeenCalledOnce();
    await expect(stat(cachePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a precise safe cache failure and does not treat it as npm failure", async () => {
    const path = await repository();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      runSandbox.mockResolvedValue({ status: "failed", exitCode: 74,
        stdout: report({ uid: 1000, gid: 1000, context: "container_t", stage: "mkdir", code: "EACCES", ok: false }),
        stderr: "", durationMs: 1 });
      const result = await applyDependencySecurityFix(path, proposal);
      expect(result.summary).toBe("Dependency cache preflight failed at mkdir: EACCES.");
      expect(log.mock.calls.some(([label]) => label === "[DeployGuard Cache Preflight]")).toBe(true);
    } finally { log.mockRestore(); }
  });

  it("fails closed when a failed container has no preflight report", async () => {
    const path = await repository();
    runSandbox.mockResolvedValue({ status: "failed", exitCode: 1, stdout: "", stderr: "", durationMs: 1 });
    const result = await applyDependencySecurityFix(path, proposal);
    expect(result.summary).toBe("Dependency cache preflight did not report a result.");
  });

  it("rejects a cache root inside the service-private /tmp", async () => {
    const path = await repository();
    process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT = tmpdir();
    await expect(applyDependencySecurityFix(path, proposal)).rejects.toThrow("outside /tmp and /var/tmp");
    expect(runSandbox).not.toHaveBeenCalled();
  });
});
