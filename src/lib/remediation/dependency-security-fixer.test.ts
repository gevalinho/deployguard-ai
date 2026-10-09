import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const runSandbox = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", () => ({
  runDockerSandboxCommand: runSandbox,
  SandboxContainerStateUnknownError: class extends Error {},
}));

import { SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";
import { applyDependencySecurityFix } from "./dependency-security-fixer";

const repositories: string[] = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  for (const path of repositories) await rm(path, { recursive: true, force: true });
  repositories.length = 0;
  runSandbox.mockReset();
});

async function repository() {
  const path = await mkdtemp(join(tmpdir(), "deployguard-fixer-test-"));
  repositories.push(path);
  await writeFile(join(path, "package-lock.json"), "{}");
  return path;
}

const proposal = {
  id: "test", title: "test", description: "test",
  target: { checkId: "test", category: "security", evidenceIndexes: [] },
  strategy: "dependency_security", risk: "safe",
} as Parameters<typeof applyDependencySecurityFix>[1];

describe("dependency security cache", () => {
  it.each(["passed", "failed", "timed_out"])("mounts a private writable cache and removes it after %s", async (status) => {
    const path = await repository();
    let cachePath = "";
    runSandbox.mockImplementation(async (input) => {
      cachePath = input.mounts[0].source;
      expect(input.mounts[0].target).toBe("/tmp/npm-cache");
      expect(input.mounts[0].selinuxPrivate).toBe(true);
      expect(input.environment.npm_config_cache).toBe("/tmp/npm-cache");
      expect(input.user).toMatch(/^[1-9]\d*:\d+$/);
      const metadata = await stat(cachePath);
      expect(metadata.mode & 0o777).toBe(0o700);
      expect(metadata.uid).toBe(Number(input.user.split(":")[0]));
      await writeFile(join(cachePath, "probe"), "ok");
      expect(await readFile(join(cachePath, "probe"), "utf8")).toBe("ok");
      return { status, exitCode: status === "passed" ? 0 : 1, stdout: "", stderr: "", durationMs: 1 };
    });
    const result = await applyDependencySecurityFix(path, proposal);
    expect(result.status).toBe(status === "passed" ? "applied" : "failed");
    await expect(stat(cachePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans up after a sandbox exception", async () => {
    const path = await repository();
    let cachePath = "";
    runSandbox.mockImplementation(async (input) => {
      cachePath = input.mounts[0].source;
      throw new Error("Docker unavailable");
    });
    await expect(applyDependencySecurityFix(path, proposal)).rejects.toThrow("Docker unavailable");
    await expect(stat(cachePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains the cache if Docker cannot confirm container termination", async () => {
    const path = await repository();
    let cachePath = "";
    runSandbox.mockImplementation(async (input) => {
      cachePath = input.mounts[0].source;
      throw new SandboxContainerStateUnknownError("container still running");
    });
    await expect(applyDependencySecurityFix(path, proposal)).rejects.toThrow("container still running");
    expect((await stat(cachePath)).isDirectory()).toBe(true);
    const { rm } = await import("node:fs/promises");
    await rm(cachePath, { recursive: true, force: true });
  });
});
