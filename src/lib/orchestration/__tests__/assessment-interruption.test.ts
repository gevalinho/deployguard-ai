import { afterEach, describe, expect, it, vi } from "vitest";
import { AssessmentInterruptedError } from "../assessment-interruption";
import { SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";
import { assertArtifactCanBeDeleted, reconcileRetainedArtifact } from "@/lib/remediation/frozen-artifact-ownership";
import { createAssessmentExecutionContext } from "../assessment-execution";
import { readPreparationOwnershipRecord } from "../preparation-ownership";
import { rmSync } from "node:fs";
import { CommandTerminationUnconfirmedError } from "@/lib/execution/command-runner";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), audit: vi.fn(), build: vi.fn(), report: vi.fn(), cleanup: vi.fn(),
  ingest: vi.fn(), reconcile: vi.fn(), environment: vi.fn(),
}));
vi.mock("@/lib/sandbox/docker-sandbox", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sandbox/docker-sandbox")>(),
  reconcileSandboxContainer: mocks.reconcile,
}));
vi.mock("@/lib/repository/repository-ingestion", () => ({
  ingestGitHubRepository: async (repository: unknown) => {
    if (mocks.ingest.getMockImplementation()) return mocks.ingest(repository);
    return { repository, repositoryPath: "/tmp/repository",
      provenance: { source: "verified-cache", remoteVerified: true }, cleanup: mocks.cleanup };
  },
}));
vi.mock("@/lib/scanner/repository-scanner", () => ({
  scanRepository: async () => ({ repositoryPath: "/tmp/repository", facts: [], scannedAt: "" }),
}));
vi.mock("@/lib/sandbox/workspace-preparation", () => ({ prepareSandboxWorkspace: mocks.prepare }));
vi.mock("@/lib/agents/research-agent", () => ({
  runResearchAgent: async () => ({ queries: [], results: [] }),
}));
vi.mock("@/lib/agents/architect-agent", () => ({
  runArchitectAgent: async () => { throw new Error("optional AI unavailable"); },
}));
vi.mock("@/lib/agents/environment-agent", () => ({
  runEnvironmentAgent: async () => mocks.environment.getMockImplementation()
    ? mocks.environment() : ({ id: "environment", category: "environment",
      name: "Environment", status: "passed", summary: "Passed" }),
}));
vi.mock("@/lib/agents/deployment-agent", () => ({
  runDeploymentAgent: async () => ({ id: "deployment", category: "deployment",
    name: "Deployment", status: "passed", summary: "Passed" }),
}));
vi.mock("@/lib/agents/sandbox-typecheck-agent", () => ({
  runSandboxTypecheckAgent: async () => ({ id: "types", category: "types",
    name: "Types", status: "passed", summary: "Passed" }),
}));
vi.mock("@/lib/agents/sandbox-lint-agent", () => ({
  runSandboxLintAgent: async () => ({ id: "lint", category: "lint",
    name: "Lint", status: "passed", summary: "Passed" }),
}));
vi.mock("@/lib/agents/sandbox-test-agent", () => ({
  runSandboxTestAgent: async () => ({ id: "test", category: "test",
    name: "Tests", status: "passed", summary: "Passed" }),
}));
vi.mock("@/lib/agents/sandbox-build-agent", () => ({ runSandboxBuildAgent: mocks.build }));
vi.mock("@/lib/agents/sandbox-security-agent", () => ({ runSandboxSecurityAgent: mocks.audit }));
vi.mock("@/lib/reporting/readiness-report", () => ({ createProductionReadinessReport: mocks.report }));

import { runRemoteReadinessAssessment } from "../remote-readiness-orchestrator";

const passed = { status: "passed", summary: "Prepared", stdout: "", stderr: "", durationMs: 1 };
const auditPassed = { id: "security", category: "security", name: "Security",
  status: "passed", summary: "Passed" };
const buildPassed = { id: "build", category: "build", name: "Build",
  status: "passed", summary: "Passed" };
const assess = () => runRemoteReadinessAssessment("https://github.com/owner/repo");
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe("essential interruption completion gate", () => {
  it("keeps the workspace while cancelled preparation settles after static checks", async () => {
    const preparation = deferred<typeof passed>();
    const environment = deferred<{ id: string; category: string; name: string; status: string; summary: string }>();
    mocks.prepare.mockReturnValue(preparation.promise);
    mocks.environment.mockReturnValue(environment.promise);
    const context = createAssessmentExecutionContext();
    const pending = context.run(assess);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AssessmentCancelledError" });
    await vi.waitFor(() => expect(mocks.environment).toHaveBeenCalledOnce());
    expect(mocks.prepare).toHaveBeenCalledOnce();
    context.cancel("user_requested");
    environment.resolve({ id: "environment", category: "environment", name: "Environment",
      status: "passed", summary: "Passed" });
    await vi.waitFor(() => expect(context.signal.aborted).toBe(true));
    expect(mocks.cleanup).not.toHaveBeenCalled();
    preparation.resolve(passed);
    await assertion;
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.report).not.toHaveBeenCalled();
    context.dispose();
  });

  it("keeps the workspace until preparation settles after the scan deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const preparation = deferred<typeof passed>();
    const environment = deferred<{ id: string; category: string; name: string; status: string; summary: string }>();
    const environmentStarted = deferred<void>();
    mocks.prepare.mockReturnValue(preparation.promise);
    mocks.environment.mockImplementation(() => {
      environmentStarted.resolve();
      return environment.promise;
    });
    const context = createAssessmentExecutionContext();
    const pending = context.run(assess);
    const assertion = expect(pending).rejects.toMatchObject({ outcome: {
      reason: "stage_deadline_exceeded" } });
    await environmentStarted.promise;
    await vi.advanceTimersByTimeAsync(45_100);
    environment.resolve({ id: "environment", category: "environment", name: "Environment",
      status: "passed", summary: "Passed" });
    await Promise.resolve();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    preparation.resolve(passed);
    await assertion;
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.report).not.toHaveBeenCalled();
    context.dispose();
  });

  it("retains the workspace when preparation cannot be proven settled in the cleanup reserve", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const workspace = "/tmp/deployguard-stalled-preparation-fixture";
    const preparation = deferred<typeof passed>();
    const environment = deferred<never>();
    const environmentStarted = deferred<void>();
    mocks.ingest.mockImplementation(async (repository) => ({ repository, repositoryPath: workspace,
      provenance: { source: "verified-cache", remoteVerified: true }, cleanup: mocks.cleanup }));
    mocks.prepare.mockReturnValue(preparation.promise);
    mocks.environment.mockImplementation(() => {
      environmentStarted.resolve();
      return environment.promise;
    });
    const context = createAssessmentExecutionContext();
    const pending = context.run(assess);
    const assertion = expect(pending).rejects.toMatchObject({ outcome: {
      reason: "assessment_cleanup_unconfirmed", retryable: false } });
    await environmentStarted.promise;
    context.cancel("user_requested");
    environment.reject(new Error("cancelled"));
    await vi.advanceTimersByTimeAsync(120_100);
    await assertion;
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(() => assertArtifactCanBeDeleted(workspace)).toThrow();
    expect(mocks.report).not.toHaveBeenCalled();
    const record = log.mock.calls.find(([message]) =>
      message === "[DeployGuard Assessment] Preparation did not settle; workspace retained.");
    const directory = (record?.[1] as { ownershipDirectory?: string } | undefined)?.ownershipDirectory;
    expect(readPreparationOwnershipRecord(directory!)).toMatchObject({ workspacePath: workspace });
    rmSync(directory!, { recursive: true, force: true });
    preparation.resolve(passed);
    context.dispose();
  });

  it("retains owned mounts when preparation reports unknown Docker state after cancellation", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const preparation = deferred<typeof passed>();
    const environment = deferred<never>();
    mocks.prepare.mockReturnValue(preparation.promise);
    mocks.environment.mockReturnValue(environment.promise);
    const context = createAssessmentExecutionContext();
    const pending = context.run(assess);
    const assertion = expect(pending).rejects.toMatchObject({ outcome: {
      reason: "sandbox_cleanup_unconfirmed", retryable: false } });
    await vi.waitFor(() => expect(mocks.environment).toHaveBeenCalledOnce());
    context.cancel("user_requested");
    environment.reject(new Error("cancelled"));
    const unknown = new SandboxContainerStateUnknownError("Docker inspection failed", "test",
      "b".repeat(64), undefined, ["/tmp/repository", "/tmp/shared-npm-cache"]);
    preparation.reject(unknown);
    await assertion;
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(() => assertArtifactCanBeDeleted("/tmp/shared-npm-cache")).toThrow();
    expect(mocks.report).not.toHaveBeenCalled();
    const record = log.mock.calls.find(([message]) =>
      message === "[DeployGuard Assessment] Docker cleanup unconfirmed; mounts retained.");
    const recoveryId = (record?.[1] as { recoveryId?: string } | undefined)?.recoveryId;
    mocks.reconcile.mockResolvedValue(undefined);
    await reconcileRetainedArtifact(recoveryId!);
    context.dispose();
  });

  it("retains preparation ownership when child termination is unconfirmed after cancellation", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const workspace = "/tmp/deployguard-unconfirmed-child-fixture";
    mocks.ingest.mockImplementation(async (repository) => ({ repository, repositoryPath: workspace,
      provenance: { source: "verified-cache", remoteVerified: true }, cleanup: mocks.cleanup }));
    const preparation = deferred<typeof passed>();
    const environment = deferred<never>();
    mocks.prepare.mockReturnValue(preparation.promise);
    mocks.environment.mockReturnValue(environment.promise);
    const context = createAssessmentExecutionContext();
    const pending = context.run(assess);
    const assertion = expect(pending).rejects.toMatchObject({ outcome: {
      reason: "assessment_cleanup_unconfirmed", retryable: false } });
    await vi.waitFor(() => expect(mocks.environment).toHaveBeenCalledOnce());
    context.cancel("user_requested");
    environment.reject(new Error("cancelled"));
    preparation.reject(new CommandTerminationUnconfirmedError(43210));
    await assertion;
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
    const record = log.mock.calls.find(([message]) =>
      message === "[DeployGuard Assessment] Child process termination unconfirmed; workspace retained.");
    const directory = (record?.[1] as { ownershipDirectory?: string } | undefined)?.ownershipDirectory;
    expect(readPreparationOwnershipRecord(directory!)).toMatchObject({ workspacePath: workspace });
    rmSync(directory!, { recursive: true, force: true });
    context.dispose();
  });

  it("does not confirm cancellation when workspace deletion throws", async () => {
    mocks.prepare.mockResolvedValue(passed);
    mocks.environment.mockImplementation(async () => { throw new Error("cancelled"); });
    mocks.cleanup.mockImplementation(() => { throw new Error("private cleanup detail"); });
    const context = createAssessmentExecutionContext();
    const pending = context.run(assess);
    const assertion = expect(pending).rejects.toMatchObject({ outcome: {
      reason: "assessment_cleanup_unconfirmed", retryable: false } });
    await vi.waitFor(() => expect(mocks.environment).toHaveBeenCalledOnce());
    context.cancel("user_requested");
    await assertion;
    expect(mocks.report).not.toHaveBeenCalled();
    context.dispose();
  });
  it("interrupts a GitHub DNS outage before any score is published", async () => {
    mocks.ingest.mockRejectedValue(new Error("Could not resolve host: github.com"));
    await expect(assess()).rejects.toMatchObject({
      outcome: { stage: "repository", service: "GitHub", reason: "github_unavailable" },
    });
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it("interrupts after bounded dependency preparation failure without publishing a score", async () => {
    mocks.prepare.mockResolvedValue({ ...passed, status: "failed", failureKind: "network",
      summary: "Package registry unavailable" });
    await expect(assess()).rejects.toMatchObject({
      outcome: { status: "interrupted", stage: "preparation",
        reason: "dependency_registry_unavailable", retryable: true },
    });
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });

  it("recovers when the second dependency attempt succeeds", async () => {
    mocks.prepare.mockResolvedValueOnce({ ...passed, status: "failed", failureKind: "network" })
      .mockResolvedValueOnce(passed);
    mocks.build.mockResolvedValue(buildPassed);
    mocks.audit.mockResolvedValue(auditPassed);
    mocks.report.mockImplementation(async (_scan, checks, readiness) => ({
      repository: { path: "", scannedAt: "", facts: [] }, checks, readiness, remediation: [],
      generatedAt: "", aiAvailability: { architecture: "unavailable", remediation: "not_needed" },
    }));
    const result = await assess();
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(result.report.readiness.score).toBe(100);
    expect(mocks.report).toHaveBeenCalledOnce();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });

  it("retains the workspace and every mount until an operator confirms Docker stopped", async () => {
    const error = new SandboxContainerStateUnknownError("Docker inspection failed", "deployguard-test",
      "a".repeat(64), undefined,
      ["/tmp/repository", "/tmp/shared-npm-cache", "/tmp/shared-corepack-cache"]);
    mocks.prepare.mockRejectedValue(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(assess()).rejects.toMatchObject({ outcome: {
      status: "interrupted", reason: "sandbox_cleanup_unconfirmed", retryable: false,
    } });
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
    for (const path of error.mountedPaths)
      expect(() => assertArtifactCanBeDeleted(path)).toThrow("Artifact may still be Docker-mounted.");
    const record = log.mock.calls.find(([message]) =>
      message === "[DeployGuard Assessment] Docker cleanup unconfirmed; mounts retained.");
    const recoveryId = (record?.[1] as { recoveryId?: string } | undefined)?.recoveryId;
    expect(recoveryId).toEqual(expect.any(String));
    mocks.reconcile.mockRejectedValueOnce(new SandboxContainerStateUnknownError("Still running"));
    await expect(reconcileRetainedArtifact(recoveryId!)).rejects.toThrow("Still running");
    expect(mocks.cleanup).not.toHaveBeenCalled();
    mocks.reconcile.mockResolvedValueOnce(undefined);
    await reconcileRetainedArtifact(recoveryId!);
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.reconcile).toHaveBeenCalledWith(error, "/tmp/repository");
    for (const path of error.mountedPaths)
      expect(() => assertArtifactCanBeDeleted(path)).not.toThrow();
  });

  it("preserves Docker ownership errors when preparation progress delivery fails", async () => {
    const unknown = new SandboxContainerStateUnknownError("Docker inspection failed", "test",
      "c".repeat(64), undefined, ["/tmp/repository", "/tmp/progress-failure-cache"]);
    mocks.prepare.mockRejectedValue(unknown);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runRemoteReadinessAssessment("https://github.com/owner/repo", {
      onProgress: async (event) => {
        if (event.stage === "preparation" && event.status === "error")
          throw new Error("progress delivery failed");
      },
    })).rejects.toMatchObject({ outcome: { reason: "sandbox_cleanup_unconfirmed" } });
    expect(mocks.cleanup).not.toHaveBeenCalled();
    const record = log.mock.calls.find(([message]) =>
      message === "[DeployGuard Assessment] Docker cleanup unconfirmed; mounts retained.");
    const recoveryId = (record?.[1] as { recoveryId?: string } | undefined)?.recoveryId;
    mocks.reconcile.mockResolvedValue(undefined);
    await reconcileRetainedArtifact(recoveryId!);
  });

  it("interrupts after audit service retry exhaustion", async () => {
    mocks.prepare.mockResolvedValue(passed);
    mocks.build.mockResolvedValue(buildPassed);
    mocks.audit.mockResolvedValue({ ...auditPassed, status: "blocked",
      transientFailure: "audit_service" });
    await expect(assess()).rejects.toBeInstanceOf(AssessmentInterruptedError);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });

  it("interrupts on approved build asset failure without running audit", async () => {
    mocks.prepare.mockResolvedValue(passed);
    mocks.build.mockResolvedValue({ ...buildPassed, status: "blocked",
      transientFailure: "approved_build_asset" });
    await expect(assess()).rejects.toMatchObject({
      outcome: { stage: "build", service: "Google Fonts" },
    });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("does not retry a build that requires external sandbox network access", async () => {
    mocks.prepare.mockResolvedValue(passed);
    mocks.build.mockResolvedValue({ ...buildPassed, status: "blocked",
      blockedByExternalNetwork: true });
    await expect(assess()).rejects.toMatchObject({
      outcome: { stage: "build", reason: "external_build_dependency_unavailable",
        retryable: false },
    });
    expect(mocks.build).toHaveBeenCalledOnce();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("does not interrupt for repository preparation failures", async () => {
    mocks.prepare.mockResolvedValue({ ...passed, status: "failed",
      failureKind: "repository", summary: "Lockfile mismatch" });
    mocks.report.mockImplementation(async (_scan, checks, readiness) => ({
      repository: { path: "", scannedAt: "", facts: [] }, checks, readiness,
      remediation: [], generatedAt: "",
    }));
    const result = await assess();
    expect(result.report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "build", status: "error" }),
    ]));
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.report).toHaveBeenCalledOnce();
  });
});
