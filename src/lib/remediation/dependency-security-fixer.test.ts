import { mkdtemp, readdir, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const runSandbox = vi.hoisted(() => vi.fn());
const reconcile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sandbox/docker-sandbox")>(),
  runDockerSandboxCommand: runSandbox,
  reconcileSandboxContainer: reconcile,
}));
import { applyDependencySecurityFix } from "./dependency-security-fixer";
import { SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";
import { FrozenArtifactContainerStateError } from "./frozen-artifact-ownership";

const repositories: string[] = [];
const cacheRoots: string[] = [];
const originalCacheRoot = process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT;
afterEach(async () => {
  for (const path of repositories)
    await rm(path, { recursive: true, force: true });
  for (const path of cacheRoots)
    await rm(path, { recursive: true, force: true });
  repositories.length = 0;
  cacheRoots.length = 0;
  if (originalCacheRoot === undefined)
    delete process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT;
  else process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT = originalCacheRoot;
  runSandbox.mockReset();
  reconcile.mockReset();
});
async function repository() {
  // The production cache policy forbids /tmp. A test checkout under /tmp
  // therefore needs an isolated writable base outside /tmp (for example /dev/shm).
  const cacheBase = process.env.DEPLOYGUARD_TEST_CACHE_BASE ?? process.cwd();
  const cacheRoot = await mkdtemp(
    join(cacheBase, ".deployguard-cache-test-"),
  );
  cacheRoots.push(cacheRoot);
  process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT = cacheRoot;
  const path = await mkdtemp(join(tmpdir(), "deployguard-fixer-test-"));
  repositories.push(path);
  await writeFile(
    join(path, "package.json"),
    JSON.stringify({
      name: "deployguard-remediation-test",
      version: "1.0.0",
      dependencies: {
        braces: "3.0.2",
      },
    }),
  );

  await writeFile(
    join(path, "package-lock.json"),
    JSON.stringify({
      name: "deployguard-remediation-test",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "deployguard-remediation-test",
          version: "1.0.0",
          dependencies: {
            braces: "3.0.2",
          },
        },
        "node_modules/braces": {
          version: "3.0.2",
        },
      },
    }),
  );
  return path;
}
const proposal = {
  id: "test",
  title: "test",
  description: "test",
  target: { checkId: "test", category: "security", evidenceIndexes: [] },
  strategy: "dependency_security",
  risk: "breaking_change_allowed",
  packageName: "braces",
  advisoryId: "12345",
} as Parameters<typeof applyDependencySecurityFix>[1];

const validBaselineAudit = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    braces: {
      name: "braces",
      severity: "high",
      isDirect: true,
      via: [{ name: "braces", severity: "high", source: 12345 }],
      effects: [],
      range: "<3.0.3",
      nodes: ["node_modules/braces"],
      fixAvailable: {
        name: "braces",
        version: "3.0.3",
        isSemVerMajor: false,
      },
    },
  },
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 1,
      critical: 0,
      total: 1,
    },
  },
});
const report = (value: object) =>
  `DEPLOYGUARD_CACHE_PREFLIGHT:${JSON.stringify(value)}\n`;

describe("dependency cache preflight", () => {
  it("retains the mounted cache and repository until the original Docker ID is reconciled", async () => {
    const path = await repository();
    const cacheRoot = process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT!;
    runSandbox.mockRejectedValueOnce(new SandboxContainerStateUnknownError(
      "Mutation state unknown.", "deployguard-mutation", "b".repeat(64)));
    const error = await applyDependencySecurityFix(path, proposal, validBaselineAudit)
      .catch((caught) => caught) as FrozenArtifactContainerStateError;
    expect(error).toBeInstanceOf(FrozenArtifactContainerStateError);
    expect(error.containerId).toBe("b".repeat(64));
    expect(error.artifacts).toContain(path);
    const cachePath = error.artifacts.find((artifact) => artifact !== path)!;
    expect(await readdir(cacheRoot)).toHaveLength(1);
    expect((await stat(cachePath)).isDirectory()).toBe(true);
    reconcile.mockRejectedValueOnce(new SandboxContainerStateUnknownError("Inspection failed."));
    await expect(error.reconcile()).rejects.toThrow("Inspection failed.");
    expect((await stat(cachePath)).isDirectory()).toBe(true);
    reconcile.mockResolvedValueOnce(undefined);
    await error.reconcile();
    expect(reconcile.mock.calls.at(-1)?.[0]).toMatchObject({ containerId: "b".repeat(64) });
    expect(await readdir(cacheRoot)).toHaveLength(0);
    expect((await stat(path)).isDirectory()).toBe(true);
  });
  it("rejects missing baseline audit without executing Docker", async () => {
    const path = await repository();

    const result = await applyDependencySecurityFix(path, proposal, "");

    expect(result.status).toBe("unsupported");
    expect(result.summary).toContain("valid baseline audit");
    expect(runSandbox).not.toHaveBeenCalled();
  });

  it("uses the same private mount, user and limits as npm and cleans up", async () => {
    const path = await repository();
    let cachePath = "";
    runSandbox.mockImplementation(async (input) => {
      cachePath = input.mounts[0].source;
      expect(
        cachePath.startsWith(cacheRoots[0] + "/deployguard-npm-cache-"),
      ).toBe(true);
      expect(cachePath.startsWith("/tmp/")).toBe(false);
      expect(input.mounts[0]).toMatchObject({
        target: "/tmp/npm-cache",
        selinuxPrivate: true,
      });
      expect(input.command.slice(5)).toEqual([
        "install",
        "braces@3.0.3",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        "--save-prod",
      ]);
      expect(input.command.slice(3, 5)).toEqual(input.user.split(":"));
      expect(input.command[2]).toContain('cp.spawnSync("npm"');
      expect(input.user).toMatch(/^[1-9]\d*:\d+$/);
      expect(input.limits).toEqual({
        memoryMb: 2048,
        cpus: 1,
        timeoutMs: 120_000,
      });
      expect((await stat(cachePath)).mode & 0o777).toBe(0o700);
      return {
        status: "passed",
        exitCode: 0,
        stdout: report({
          uid: 1000,
          gid: 1000,
          context: "container_t",
          ok: true,
        }),
        stderr: "",
        durationMs: 1,
      };
    });
    expect(
      (await applyDependencySecurityFix(path, proposal, validBaselineAudit))
        .status,
    ).toBe("applied");
    expect(runSandbox).toHaveBeenCalledOnce();
    await expect(stat(cachePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a precise safe cache failure and does not treat it as npm failure", async () => {
    const path = await repository();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      runSandbox.mockResolvedValue({
        status: "failed",
        exitCode: 74,
        stdout: report({
          uid: 1000,
          gid: 1000,
          context: "container_t",
          stage: "mkdir",
          code: "EACCES",
          ok: false,
        }),
        stderr: "",
        durationMs: 1,
      });
      const result = await applyDependencySecurityFix(
        path,
        proposal,
        validBaselineAudit,
      );
      expect(result.summary).toBe(
        "Dependency cache preflight failed at mkdir: EACCES.",
      );
      expect(
        log.mock.calls.some(
          ([label]) => label === "[DeployGuard Cache Preflight]",
        ),
      ).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("fails closed when a failed container has no preflight report", async () => {
    const path = await repository();
    runSandbox.mockResolvedValue({
      status: "failed",
      exitCode: 1,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });
    const result = await applyDependencySecurityFix(
      path,
      proposal,
      validBaselineAudit,
    );
    expect(result.summary).toBe(
      "Dependency cache preflight did not report a result.",
    );
  });

  it("rejects a cache root inside the service-private /tmp", async () => {
    const path = await repository();
    process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT = tmpdir();
    await expect(
      applyDependencySecurityFix(path, proposal, validBaselineAudit),
    ).rejects.toThrow("outside /tmp and /var/tmp");
    expect(runSandbox).not.toHaveBeenCalled();
  });

  it("fails closed when npm exits one after changing the lockfile", async () => {
    const path = await repository();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      runSandbox.mockImplementation(async () => {
        await writeFile(join(path, "package-lock.json"), '{"changed":true}');
        return {
          status: "failed",
          exitCode: 1,
          stdout:
            report({ uid: 1000, gid: 1000, context: "container_t", ok: true }) +
            "found 2 vulnerabilities\n",
          stderr:
            "npm ERR! request https://user:secret@example.test/path token=abc123",
          durationMs: 41_000,
        };
      });
      const result = await applyDependencySecurityFix(
        path,
        proposal,
        validBaselineAudit,
      );
      expect(result.status).toBe("failed");
      const diagnostic = log.mock.calls.find(
        ([label]) => label === "[DeployGuard Remediation npm failure]",
      )?.[1];
      expect(diagnostic).toMatchObject({
        category: "unresolved_vulnerabilities",
        dependencyChanged: true,
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
      expect(JSON.stringify(log.mock.calls)).not.toContain("abc123");
      expect(JSON.stringify(log.mock.calls)).not.toContain("example.test");
      const preflight = log.mock.calls.find(
        ([label]) => label === "[DeployGuard Cache Preflight]",
      )?.[1];
      expect(preflight).not.toHaveProperty("stage");
      expect(preflight).not.toHaveProperty("code");
    } finally {
      log.mockRestore();
    }
  });

  it("reports execution failure when npm exits one without changing dependency files", async () => {
    const path = await repository();
    runSandbox.mockResolvedValue({
      status: "failed",
      exitCode: 1,
      stdout: report({ uid: 1000, gid: 1000, ok: true }),
      stderr: "npm ERR! failure",
      durationMs: 1,
    });
    expect(
      (await applyDependencySecurityFix(path, proposal, validBaselineAudit))
        .status,
    ).toBe("failed");
  });

  it.each([
    ["EACCES", "permission_failure"],
    ["ERESOLVE", "dependency_conflict"],
    ["ENOTFOUND", "registry_failure"],
    ["ETARGET", "unsupported_fix"],
  ])("logs only a safe %s classification", async (code, category) => {
    const path = await repository();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      runSandbox.mockResolvedValue({
        status: "failed",
        exitCode: 1,
        stdout: report({ uid: 1000, gid: 1000, ok: true }),
        stderr: `npm ERR! ${code} credential-value-that-must-not-log`,
        durationMs: 1,
      });
      await applyDependencySecurityFix(path, proposal, validBaselineAudit);
      expect(
        log.mock.calls.find(
          ([label]) => label === "[DeployGuard Remediation npm failure]",
        )?.[1],
      ).toMatchObject({ category });
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        "credential-value-that-must-not-log",
      );
    } finally {
      log.mockRestore();
    }
  });
});
