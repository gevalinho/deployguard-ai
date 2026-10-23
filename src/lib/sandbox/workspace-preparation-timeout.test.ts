import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  runDocker: vi.fn(),
  detectPackageManager: vi.fn(),
  createIdentity: vi.fn(),
  hasCache: vi.fn(),
  restoreCache: vi.fn(),
  saveCache: vi.fn(),
  getCorepackConfig: vi.fn(),
}));

vi.mock("./docker-sandbox", () => ({
  runDockerSandboxCommand: mocks.runDocker,
}));

vi.mock("./package-manager", () => ({
  detectPackageManager: mocks.detectPackageManager,
}));

vi.mock("./dependency-cache", () => ({
  createDependencyCacheIdentity: mocks.createIdentity,
  hasDependencyCache: mocks.hasCache,
  restoreDependencyCache: mocks.restoreCache,
  saveDependencyCache: mocks.saveCache,
}));

vi.mock("./corepack-cache", () => ({
  getCorepackSandboxConfig: mocks.getCorepackConfig,
}));

import {
  DEPENDENCY_PREPARATION_TIMEOUT_MS,
  prepareSandboxWorkspace,
} from "./workspace-preparation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Dependency preparation timeout", () => {
  it("rejects repository-supplied Yarn executable before Docker", async () => {
    const root = mkdtempSync(join(tmpdir(), "deployguard-yarn-path-"));
    try {
      writeFileSync(join(root, ".yarnrc.yml"), "yarnPath: .yarn/releases/yarn.cjs\n");
      mocks.detectPackageManager.mockReturnValue({
        name: "yarn", lockfile: "yarn.lock", source: "lockfile_and_package_json",
        version: "4.9.2", majorVersion: 4, yarnMode: "modern",
      });
      const result = await prepareSandboxWorkspace(root, { requirements: [] });
      expect(result.failureKind).toBe("repository");
      expect(result.summary).toContain("yarnPath");
      expect(mocks.runDocker).not.toHaveBeenCalled();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects unsupported pnpm lockfiles before Docker", async () => {
    mocks.detectPackageManager.mockReturnValue({
      name: "pnpm", lockfile: "pnpm-lock.yaml", source: "lockfile",
      compatibilityKind: "capability", compatibilityError: "DeployGuard does not support pnpm lockfileVersion 10.0.",
    });
    const result = await prepareSandboxWorkspace("/tmp/unsupported-pnpm", { requirements: [] });
    expect(result.failureKind).toBe("capability");
    expect(result.summary).toContain("10.0");
    expect(mocks.runDocker).not.toHaveBeenCalled();
  });

  it("uses the exact pnpm fallback with frozen, script-free Docker installation", async () => {
    const root = mkdtempSync(join(tmpdir(), "deployguard-pnpm-store-"));
    try {
    const lockfile = "lockfileVersion: '6.0'\n";
    writeFileSync(join(root, "pnpm-lock.yaml"), lockfile);
    mocks.detectPackageManager.mockReturnValue({
      name: "pnpm", lockfile: "pnpm-lock.yaml", source: "lockfile",
      version: "8.15.9", majorVersion: 8,
    });
    mocks.getCorepackConfig.mockReturnValue({ environment: { COREPACK_HOME: "/deployguard-cache/corepack" }, mounts: [] });
    mocks.runDocker.mockResolvedValue({ status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
    const result = await prepareSandboxWorkspace(root, { requirements: [] });
    expect(result.status).toBe("passed");
    expect(existsSync(join(root, ".deployguard-pnpm-store"))).toBe(true);
    expect(readFileSync(join(root, "pnpm-lock.yaml"), "utf8")).toBe(lockfile);
    expect(mocks.runDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: ["corepack", "pnpm@8.15.9", "install", "--frozen-lockfile", "--ignore-scripts",
        "--store-dir", "/workspace/.deployguard-pnpm-store"],
      network: "bridge", limits: { memoryMb: 2048, cpus: 1, timeoutMs: 300_000 },
    }));
    } finally { rmSync(root, { recursive: true, force: true }); }
    expect(existsSync(join(root, ".deployguard-pnpm-store"))).toBe(false);
  });

  it("rejects a pnpm store symlink before Docker", async () => {
    const root = mkdtempSync(join(tmpdir(), "deployguard-pnpm-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "deployguard-pnpm-outside-"));
    try {
      symlinkSync(outside, join(root, ".deployguard-pnpm-store"));
      mocks.detectPackageManager.mockReturnValue({ name: "pnpm", lockfile: "pnpm-lock.yaml",
        source: "lockfile", version: "8.15.9", majorVersion: 8 });
      const result = await prepareSandboxWorkspace(root, { requirements: [] });
      expect(result.status).toBe("failed");
      expect(result.failureKind).toBe("infrastructure");
      expect(mocks.runDocker).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("classifies pnpm ENOSPC as sandbox capacity", async () => {
    const root = mkdtempSync(join(tmpdir(), "deployguard-pnpm-capacity-"));
    try {
      mocks.detectPackageManager.mockReturnValue({ name: "pnpm", lockfile: "pnpm-lock.yaml",
        source: "lockfile", version: "8.15.9", majorVersion: 8 });
      mocks.getCorepackConfig.mockReturnValue({ environment: {}, mounts: [] });
      mocks.runDocker.mockResolvedValue({ status: "failed", exitCode: 1,
        stdout: "ERR_PNPM_ENOSPC no space left on device", stderr: "", durationMs: 1 });
      const result = await prepareSandboxWorkspace(root, { requirements: [] });
      expect(result.failureKind).toBe("capacity");
      expect(result.summary).toContain("sandbox ran out of storage");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([
    { name: "npm", lockfile: "package-lock.json", command: "sh" },
    { name: "yarn", lockfile: "yarn.lock", command: "corepack" },
  ] as const)("does not create a pnpm store for $name", async ({ name, lockfile, command }) => {
    const root = mkdtempSync(join(tmpdir(), `deployguard-${name}-store-`));
    try {
      mocks.detectPackageManager.mockReturnValue({ name, lockfile, source: "lockfile",
        ...(name === "yarn" ? { yarnMode: "classic", majorVersion: 1 } : {}) });
      mocks.createIdentity.mockReturnValue({ key: "test-cache-identity" });
      mocks.hasCache.mockReturnValue(false);
      mocks.getCorepackConfig.mockReturnValue({ environment: {}, mounts: [] });
      mocks.runDocker.mockResolvedValue({ status: "passed", exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
      const result = await prepareSandboxWorkspace(root, { requirements: [] });
      expect(result.status).toBe("passed");
      expect(existsSync(join(root, ".deployguard-pnpm-store"))).toBe(false);
      expect(mocks.runDocker.mock.calls[0][0].command[0]).toBe(command);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  function setup() {
    mocks.detectPackageManager.mockReturnValue({
      name: "npm",
      lockfile: "package-lock.json",
      source: "lockfile",
    });

    mocks.createIdentity.mockReturnValue({
      key: "test-cache-identity",
    });

    mocks.hasCache.mockReturnValue(false);

    mocks.getCorepackConfig.mockReturnValue({
      environment: {},
      mounts: [],
    });
  }

  it("passes a five-minute timeout to Docker", async () => {
    setup();

    mocks.runDocker.mockResolvedValue({
      status: "passed",
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 100,
    });

    const result = await prepareSandboxWorkspace(
      "/tmp/deployguard-timeout-test",
      { requirements: [] },
    );

    expect(result.status).toBe("passed");
    expect(DEPENDENCY_PREPARATION_TIMEOUT_MS).toBe(300_000);

    expect(mocks.runDocker).toHaveBeenCalledWith(
      expect.objectContaining({
        limits: {
          memoryMb: 2048,
          cpus: 1,
          timeoutMs: 300_000,
        },
      }),
    );
  });

  it("classifies timeout and reports the configured duration", async () => {
    setup();

    mocks.runDocker.mockResolvedValue({
      status: "timed_out",
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: 300_000,
    });

    const result = await prepareSandboxWorkspace(
      "/tmp/deployguard-timeout-test",
      { requirements: [] },
    );

    expect(result.status).toBe("timed_out");
    expect(result.failureKind).toBe("timeout");
    expect(result.summary).toContain("300 seconds");
    expect(result.summary).toContain("npm");
  });

  it.each(["ENOTFOUND registry.npmjs.org", "EAI_AGAIN registry.npmjs.org",
    "ECONNRESET", "ERR_PNPM_FETCH_503"])("classifies transient installation output: %s", async (stderr) => {
    setup();
    mocks.runDocker.mockResolvedValue({
      status: "failed", exitCode: 1, stdout: "", stderr, durationMs: 1,
    });
    const result = await prepareSandboxWorkspace("/tmp/deployguard-timeout-test",
      { requirements: [] });
    expect(result.failureKind).toBe("network");
  });

  it("keeps a lockfile mismatch attributable to the repository", async () => {
    setup();
    mocks.runDocker.mockResolvedValue({
      status: "failed", exitCode: 1, stdout: "",
      stderr: "npm ci requires package-lock.json to match package.json", durationMs: 1,
    });
    const result = await prepareSandboxWorkspace("/tmp/deployguard-timeout-test",
      { requirements: [] });
    expect(result.failureKind).toBe("repository");
  });
});
