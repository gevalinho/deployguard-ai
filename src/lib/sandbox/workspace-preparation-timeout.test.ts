import { afterEach, describe, expect, it, vi } from "vitest";

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
});
