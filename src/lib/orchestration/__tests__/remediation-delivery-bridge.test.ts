import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TrustedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";
import type { FixProposal } from "@/lib/remediation/types";
import { SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";
import { reconcileRetainedArtifact } from "@/lib/remediation/frozen-artifact-ownership";

const state = vi.hoisted(() => ({
  provenance: { source: "verified-cache", remoteVerified: true, commitSha: "a".repeat(40), sourceBranch: "main" },
  stored: null as TrustedArtifactMetadata | null,
  corruptPersistedMetadata: false,
  path: "",
  dispose: vi.fn(),
  ingest: vi.fn(),
  mutateDuringVerification: false,
  validDependencyFixture: false,
  twoAdvisories: false,
  duplicateEvidenceIdentity: false,
  invalidFindingType: false,
  missingEvidenceIdentity: false,
  unsupportedExecution: false,
  failedCapture: false,
  trustedVerification: vi.fn(),
  unknownAt: null as "preparation" | "baseline" | "mutation" | "regressions" | null,
  reconcile: vi.fn(),
  auditCalls: 0,
}));
vi.mock("@/lib/sandbox/docker-sandbox", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sandbox/docker-sandbox")>(),
  reconcileSandboxContainer: state.reconcile,
}));
vi.mock("@/lib/repository/repository-ingestion", () => ({ ingestGitHubRepository: state.ingest }));
vi.mock("@/lib/sandbox/workspace-preparation", () => ({ prepareSandboxWorkspace: async (...args: unknown[]) => {
  expect(args).toHaveLength(1);
  expect(JSON.stringify(args)).not.toContain("private-read-authority");
  if (state.unknownAt === "preparation") throw new SandboxContainerStateUnknownError(
    "Preparation container state unknown.", "deployguard-preparation", "a".repeat(64));
  return { status: "passed" };
} }));
vi.mock("@/lib/agents/sandbox-typecheck-agent", () => ({ runSandboxTypecheckAgent: async () => {
  if (state.unknownAt === "regressions") throw new SandboxContainerStateUnknownError(
    "Typecheck state unknown.", "deployguard-types", "1".repeat(64));
  return { id: "types", status: "passed", category: "types", name: "Types", summary: "Passed" };
} }));
vi.mock("@/lib/agents/sandbox-test-agent", () => ({ runSandboxTestAgent: async () => ({ id: "tests", status: "passed", category: "tests", name: "Tests", summary: "Passed" }) }));
vi.mock("@/lib/agents/sandbox-build-agent", () => ({ runSandboxBuildAgent: async () => {
  if (state.unknownAt === "regressions") throw new SandboxContainerStateUnknownError(
    "Build state unknown.", "deployguard-build", "2".repeat(64));
  return { id: "build", status: "passed", category: "build", name: "Build", summary: "Passed" };
} }));
vi.mock("@/lib/agents/sandbox-lint-agent", () => ({ runSandboxLintAgent: async () => ({ id: "lint", status: "failed", category: "lint", name: "Lint", summary: "Failed", evidence: [] }) }));
vi.mock("@/lib/remediation/lint-autofix-fixer", () => ({ applyLintAutofix: async (path: string) => {
  writeFileSync(join(path, "example.ts"), "export const value = 1;\n");
  return { status: "applied", summary: "Applied" };
} }));
vi.mock("@/lib/remediation/lint-autofix-verifier", () => ({ verifyLintAutofix: async () => ({
  status: "proven", summary: "Verified", comparisons: [], regressionChecks: [],
}) }));
vi.mock("@/lib/agents/sandbox-security-agent", () => ({
  parseNpmStyleAuditReport: () => [{ packageName: "braces", severity: "high",
    advisoryIds: state.twoAdvisories ? ["123", "456"] : ["123"] }],
  runSandboxSecurityAgent: async () => {
    state.auditCalls++;
    if (state.unknownAt === "baseline" && state.auditCalls === 1)
      throw new SandboxContainerStateUnknownError("Baseline audit container state unknown.",
        "deployguard-baseline", "a".repeat(64));
    return ({
    id: "security", status: "failed", category: "security", name: "Security", summary: "Finding",
    evidence: [{ kind: state.invalidFindingType ? "diagnostic" : "security_finding", code: "high",
      message: "braces has a high-severity dependency vulnerability.",
      advisoryIds: state.missingEvidenceIdentity ? undefined : state.duplicateEvidenceIdentity ? ["123", "123"] :
        state.twoAdvisories ? ["123", "456"] : ["123"] },
      ...(state.twoAdvisories ? [{ kind: "security_finding", code: "high",
        message: "other has a high-severity dependency vulnerability.", advisoryIds: ["789"] }] : [])],
    });
  },
}));
vi.mock("@/lib/remediation/dependency-security-fixer", () => ({ applyDependencySecurityFix: async (path: string) => {
  if (state.unknownAt === "mutation") throw new SandboxContainerStateUnknownError(
    "Mutation container state unknown.", "deployguard-mutation", "a".repeat(64));
  if (state.unsupportedExecution) return {
    status: "unsupported", summary: "No explicit targeted fix version is available.",
  };
  if (state.failedCapture) {
    rmSync(path, { recursive: true, force: true });
    return { status: "applied", summary: "Applied before capture failed" };
  }
  if (state.validDependencyFixture) {
    const fixture = join(
      process.cwd(),
      "src/lib/remediation/__fixtures__/npm-braces-upgrade",
    );

    writeFileSync(
      join(path, "package.json"),
      readFileSync(join(fixture, "package-after.json")),
    );

    writeFileSync(
      join(path, "package-lock.json"),
      readFileSync(join(fixture, "package-lock-after.json")),
    );

    return {
      status: "applied",
      summary: "Applied authorized dependency upgrade",
      authorizedDependency: {
        packageName: "braces",
        version: "3.0.3",
      },
    };
  }

  writeFileSync(join(path, "package-lock.json"), '{"changed":true}');
  return { status: "applied", summary: "Attempted" };
} }));
vi.mock("@/lib/remediation/dependency-security-verifier", () => ({ verifyDependencySecurityFix: async (path: string) => {
  if (state.mutateDuringVerification) writeFileSync(join(path, "package-lock.json"), '{"unexpected":true}');
  return { status: "proven", summary: "Verified", comparisons: [], regressionChecks: [] };
} }));
vi.mock("@/lib/remediation/trusted-lodash-verification", () => ({
  verifyTrustedLodashRemediation: state.trustedVerification,
}));
vi.mock("@/lib/remediation/trusted-artifact-repository", () => ({
  persistVerifiedArtifact: async (identity: string, artifact: { sha256: string; byteSize: number; format: string },
    provenance: typeof state.provenance) => {
    state.stored = { id: "artifact123", repositoryIdentity: identity, sha256: artifact.sha256,
      byteSize: artifact.byteSize, format: artifact.format, createdAt: new Date(),
      sourceCommitSha: provenance.commitSha, sourceBranch: provenance.sourceBranch,
      ingestionSource: provenance.source, ingestionRemoteVerified: provenance.remoteVerified };
    return state.corruptPersistedMetadata ? { ...state.stored, repositoryIdentity: "other/repo" } : state.stored;
  },
  getVerifiedArtifactMetadata: async (id: string) => id === state.stored?.id ? state.stored : null,
}));

import { runRemoteRemediation } from "@/lib/orchestration/remediation-orchestrator";
import { deliveryApiDependencies, handleDeveloperDeliveryPost } from "@/lib/remediation/developer-delivery-api";
import { currentAssessmentArtifact } from "@/lib/remediation/current-assessment-artifact";

const proposal: FixProposal = { id: "lint-fix", title: "Fix lint", description: "Controlled fix", strategy: "lint_autofix",
  risk: "safe", target: { checkId: "lint", category: "lint", evidenceIndexes: [] } };

afterEach(() => {
  if (state.path) rmSync(state.path, { recursive: true, force: true });
  state.path = "";
  state.provenance = { source: "verified-cache", remoteVerified: true,
    commitSha: "a".repeat(40), sourceBranch: "main" };
  state.stored = null;
  state.corruptPersistedMetadata = false;
  state.dispose.mockReset();
  state.ingest.mockReset();
  state.mutateDuringVerification = false;
  state.validDependencyFixture = false;
  vi.unstubAllGlobals();
  state.twoAdvisories = false;
  state.duplicateEvidenceIdentity = false;
  state.invalidFindingType = false;
  state.missingEvidenceIdentity = false;
  state.unsupportedExecution = false;
  state.failedCapture = false;
  state.trustedVerification.mockReset();
  state.unknownAt = null;
  state.reconcile.mockReset();
  state.auditCalls = 0;
  vi.unstubAllEnvs();
});

describe("proven remediation to immediate delivery lookup", () => {
  it.each(["preparation", "baseline", "mutation"] as const)(
    "retains the ingested workspace when %s Docker state is unknown until the original ID is reconciled",
    async (stage) => {
      state.unknownAt = stage;
      state.ingest.mockImplementation(async (repository: unknown) => {
        state.path = mkdtempSync(join(tmpdir(), "dg-owned-ingested-"));
        writeFileSync(join(state.path, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
        writeFileSync(join(state.path, "package-lock.json"), "{}");
        return { repository, repositoryPath: state.path, provenance: state.provenance,
          cleanup() { state.dispose(); rmSync(state.path, { recursive: true, force: true }); } };
      });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const dependencyProposal: FixProposal = { ...proposal, strategy: "dependency_security",
          packageName: "braces", advisoryId: "123",
          target: { checkId: "security", category: "security", evidenceIndexes: [0] } };
        await expect(runRemoteRemediation("https://github.com/owner/repo", dependencyProposal))
          .rejects.toBeInstanceOf(SandboxContainerStateUnknownError);
        expect(state.dispose).not.toHaveBeenCalled();
        expect(readFileSync(join(state.path, "package.json"), "utf8")).toContain("fixture");
        const metadata = log.mock.calls.find(([label]) =>
          label === "[DeployGuard Remediation] Docker state unknown; mounted artifacts retained.")?.[1] as
          { recoveryId: string; containerId: string } | undefined;
        expect(metadata?.containerId).toBe("a".repeat(64));
        state.reconcile.mockRejectedValueOnce(new SandboxContainerStateUnknownError("Inspection failed."));
        await expect(reconcileRetainedArtifact(metadata!.recoveryId)).rejects.toThrow("Inspection failed.");
        expect(state.dispose).not.toHaveBeenCalled();
        state.reconcile.mockResolvedValueOnce(undefined);
        await reconcileRetainedArtifact(metadata!.recoveryId);
        expect(state.reconcile.mock.calls.at(-1)?.[0]).toMatchObject({ containerId: "a".repeat(64) });
        expect(state.dispose).toHaveBeenCalledOnce();
      } finally { log.mockRestore(); }
    },
  );
  it("waits for every concurrent unknown regression container before ingested cleanup", async () => {
    state.unknownAt = "regressions";
    state.validDependencyFixture = true;
    const fixture = join(process.cwd(), "src/lib/remediation/__fixtures__/npm-braces-upgrade");
    state.ingest.mockImplementation(async (repository: unknown) => {
      state.path = mkdtempSync(join(tmpdir(), "dg-owned-regressions-"));
      writeFileSync(join(state.path, "package.json"), readFileSync(join(fixture, "package-before.json")));
      writeFileSync(join(state.path, "package-lock.json"), readFileSync(join(fixture, "package-lock-before.json")));
      return { repository, repositoryPath: state.path, provenance: state.provenance,
        cleanup() { state.dispose(); rmSync(state.path, { recursive: true, force: true }); } };
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const dependencyProposal: FixProposal = { ...proposal, strategy: "dependency_security",
        packageName: "braces", advisoryId: "123",
        target: { checkId: "security", category: "security", evidenceIndexes: [0] } };
      await expect(runRemoteRemediation("https://github.com/owner/repo", dependencyProposal))
        .rejects.toBeInstanceOf(AggregateError);
      const recoveries = log.mock.calls.filter(([label]) =>
        label === "[DeployGuard Remediation] Docker state unknown; mounted artifacts retained.")
        .map(([, metadata]) => metadata as { recoveryId: string; containerId: string });
      expect(recoveries.map((item) => item.containerId)).toEqual(["1".repeat(64), "2".repeat(64)]);
      expect(state.dispose).not.toHaveBeenCalled();
      state.reconcile.mockResolvedValue(undefined);
      await Promise.all([reconcileRetainedArtifact(recoveries[0].recoveryId),
        reconcileRetainedArtifact(recoveries[0].recoveryId)]);
      expect(state.dispose).not.toHaveBeenCalled();
      expect(state.reconcile).toHaveBeenCalledTimes(1);
      await reconcileRetainedArtifact(recoveries[1].recoveryId);
      expect(state.dispose).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
  it.each([
    ["unsupported", "No explicit targeted fix version is available."],
    ["failed", "Dependency files could not be safely captured after remediation."],
  ] as const)("retains source provenance and execution details for %s remediation", async (status, summary) => {
    state.unsupportedExecution = status === "unsupported";
    state.failedCapture = status === "failed";
    state.ingest.mockImplementation(async (repository: unknown) => {
      state.path = mkdtempSync(join(tmpdir(), "dg-remediation-bridge-"));
      writeFileSync(join(state.path, "package-lock.json"), "{}");
      return { repository, repositoryPath: state.path, provenance: state.provenance,
        cleanup() { rmSync(state.path, { recursive: true, force: true }); } };
    });
    const dependencyProposal: FixProposal = { ...proposal, strategy: "dependency_security",
      packageName: "braces", advisoryId: "123",
      target: { checkId: "security", category: "security", evidenceIndexes: [0] } };
    const result = await runRemoteRemediation("https://github.com/owner/repo", dependencyProposal);
    expect(result.sourceCommitSha).toBe(state.provenance.commitSha);
    expect(result.remediation.execution).toMatchObject({ status, summary });
    expect(result.remediation.proof).toBeUndefined();
  });
  it("binds the selected evidence index to its advisory, including two on one package", async () => {
    state.twoAdvisories = true;
    state.ingest.mockImplementation(async (repository: unknown) => {
      state.path = mkdtempSync(join(tmpdir(), "dg-remediation-bridge-"));
      writeFileSync(join(state.path, "package-lock.json"), "{}");
      return { repository, repositoryPath: state.path, provenance: state.provenance,
        cleanup() { rmSync(state.path, { recursive: true, force: true }); } };
    });
    const base: FixProposal = { ...proposal, strategy: "dependency_security", packageName: "braces", advisoryId: "456",
      target: { checkId: "security", category: "security", evidenceIndexes: [0] } };
    expect((await runRemoteRemediation("https://github.com/owner/repo", base)).remediation.proof?.status).toBe("inconclusive");
    for (const mismatch of [
      { ...base, target: { ...base.target, evidenceIndexes: [1] } },
      { ...base, target: { ...base.target, evidenceIndexes: [2] } },
      { ...base, packageName: "other" },
      { ...base, advisoryId: "789" },
      { ...base, advisoryId: undefined },
    ]) await expect(runRemoteRemediation("https://github.com/owner/repo", mismatch))
      .rejects.toThrow();
    state.twoAdvisories = false;
    state.duplicateEvidenceIdentity = true;
    await expect(runRemoteRemediation("https://github.com/owner/repo", { ...base, advisoryId: "123",
      target: { ...base.target, evidenceIndexes: [0] } })).rejects.toThrow();
    state.duplicateEvidenceIdentity = false;
    state.missingEvidenceIdentity = true;
    await expect(runRemoteRemediation("https://github.com/owner/repo", { ...base, advisoryId: "123",
      target: { ...base.target, evidenceIndexes: [0] } })).rejects.toThrow();
    state.missingEvidenceIdentity = false;
    state.invalidFindingType = true;
    await expect(runRemoteRemediation("https://github.com/owner/repo", { ...base, advisoryId: "123",
      target: { ...base.target, evidenceIndexes: [0] } })).rejects.toThrow();
  });
  it("does not persist a dependency security artifact during controlled production testing", async () => {
    state.ingest.mockImplementation(async (repository: unknown) => {
      state.path = mkdtempSync(join(tmpdir(), "dg-remediation-bridge-"));
      writeFileSync(join(state.path, "package-lock.json"), "{}");
      return { repository, repositoryPath: state.path, provenance: state.provenance,
        cleanup() { rmSync(state.path, { recursive: true, force: true }); } };
    });
    const dependencyProposal: FixProposal = { ...proposal, strategy: "dependency_security",
      packageName: "braces", advisoryId: "123",
      target: { checkId: "security", category: "security", evidenceIndexes: [0] } };
    const result = await runRemoteRemediation("https://github.com/owner/repo", dependencyProposal);
    expect(result.remediation.proof?.status).toBe("inconclusive");
    expect(result.remediation.verifiedArtifactReference).toBeUndefined();
    expect(state.stored).toBeNull();
  });
  it("selects frozen verification only for the pinned fixture and passes a server contract", async () => {
    state.provenance = { source: "verified-cache", remoteVerified: true,
      commitSha: "37664ea49d1bfc714ef43c3d692571c59abf6414", sourceBranch: "main" };
    state.validDependencyFixture = true;
    const fixture = join(process.cwd(), "src/lib/remediation/__fixtures__/npm-braces-upgrade");
    state.ingest.mockImplementation(async (repository: unknown) => {
      state.path = mkdtempSync(join(tmpdir(), "dg-trusted-fixture-"));
      writeFileSync(join(state.path, "package.json"), readFileSync(join(fixture, "package-before.json")));
      writeFileSync(join(state.path, "package-lock.json"), readFileSync(join(fixture, "package-lock-before.json")));
      return { repository, repositoryPath: state.path, provenance: state.provenance,
        cleanup() { rmSync(state.path, { recursive: true, force: true }); } };
    });
    state.trustedVerification.mockResolvedValue({ proof: { status: "inconclusive",
      summary: "fixture evidence incomplete", comparisons: [], regressionChecks: [] } });
    const dependencyProposal: FixProposal = { ...proposal, strategy: "dependency_security",
      packageName: "braces", advisoryId: "123",
      target: { checkId: "security", category: "security", evidenceIndexes: [0] } };
    const fixtureUrl = "https://github.com/gevalinho/deployguard-vulnerable-fixture";
    const result = await runRemoteRemediation(fixtureUrl, dependencyProposal);
    expect(result.remediation.proof?.status).toBe("inconclusive");
    expect(state.trustedVerification).toHaveBeenCalledOnce();
    expect(state.trustedVerification.mock.calls[0][4]).toMatchObject({
      expectedTestFiles: [{ path: "test/lodash.test.js",
        sha256: "7a814fe171bc440e193138f4193439a6b1e4035917908a9a390781fe93df73dc" }],
      expectedExecutedTests: 4,
    });
    state.provenance.commitSha = "a".repeat(40);
    const wrongCommit = await runRemoteRemediation(fixtureUrl, dependencyProposal);
    expect(wrongCommit.remediation.proof?.status).toBe("inconclusive");
    expect(state.trustedVerification.mock.calls[1][4]).toBeNull();
    state.provenance.commitSha = "37664ea49d1bfc714ef43c3d692571c59abf6414";
    state.trustedVerification.mockResolvedValueOnce({ proof: { status: "proven",
      summary: "Mock proof", comparisons: [], regressionChecks: [] },
      sourceIdentity: "0".repeat(64) });
    const mismatchedSource = await runRemoteRemediation(fixtureUrl, dependencyProposal);
    expect(mismatchedSource.remediation.proof?.status).toBe("inconclusive");
    expect(mismatchedSource.remediation.verifiedPatch).toBeUndefined();
    state.trustedVerification.mockResolvedValueOnce({ proof: { status: "proven",
      summary: "Mock proof", comparisons: [], regressionChecks: [] } });
    const missingIdentity = await runRemoteRemediation(fixtureUrl, dependencyProposal);
    expect(missingIdentity.remediation.proof?.status).toBe("inconclusive");
    await runRemoteRemediation("https://github.com/owner/repo", dependencyProposal);
    expect(state.trustedVerification).toHaveBeenCalledTimes(4);
  });
  it("persists an authorized proven dependency upgrade without starting GitHub delivery", async () => {
    state.validDependencyFixture = true;

    const fixture = join(
      process.cwd(),
      "src/lib/remediation/__fixtures__/npm-braces-upgrade",
    );

    state.ingest.mockImplementation(async (repository: unknown) => {
      state.path = mkdtempSync(join(tmpdir(), "dg-remediation-bridge-"));

      writeFileSync(
        join(state.path, "package.json"),
        readFileSync(join(fixture, "package-before.json")),
      );

      writeFileSync(
        join(state.path, "package-lock.json"),
        readFileSync(join(fixture, "package-lock-before.json")),
      );

      return {
        repository,
        repositoryPath: state.path,
        provenance: state.provenance,
        cleanup() {
          state.dispose();
          rmSync(state.path, { recursive: true, force: true });
        },
      };
    });

    const updatedLock = JSON.parse(
      readFileSync(join(fixture, "package-lock-after.json"), "utf8"),
    );

    const target = updatedLock.packages["node_modules/braces"];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: "braces",
        version: "3.0.3",
        dist: {
          tarball: target.resolved,
          integrity: target.integrity,
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const dependencyProposal: FixProposal = {
      ...proposal,
      strategy: "dependency_security",
      packageName: "braces",
      advisoryId: "123",
      target: {
        checkId: "security",
        category: "security",
        evidenceIndexes: [0],
      },
    };

    const result = await runRemoteRemediation(
      "https://github.com/owner/repo",
      dependencyProposal,
    );

    expect(result.remediation.proof?.status).toBe("proven");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.remediation.verifiedPatch).toMatchObject({ fileCount: 2,
      files: [{ path: "package-lock.json" }, { path: "package.json" }] });
    expect(result.remediation.verifiedArtifactReference).toEqual({
      artifactId: "artifact123", deliveryEligible: true,
    });
    expect(currentAssessmentArtifact({ repositoryIdentity: "owner/repo",
      sourceCommitSha: state.provenance.commitSha }, {
      repositoryIdentity: result.repository.fullName, sourceCommitSha: result.sourceCommitSha,
      proofStatus: result.remediation.proof?.status,
      artifactId: result.remediation.verifiedArtifactReference?.artifactId,
      deliveryEligible: result.remediation.verifiedArtifactReference?.deliveryEligible,
    })).toEqual({ artifactId: "artifact123", deliveryEligible: true });
    expect(state.stored).toMatchObject({ repositoryIdentity: "owner/repo",
      sourceCommitSha: state.provenance.commitSha, sourceBranch: state.provenance.sourceBranch,
      ingestionRemoteVerified: true, sha256: result.remediation.verifiedPatchArtifact?.sha256 });
    expect(state.dispose).toHaveBeenCalledOnce();
  });

  it("rejects an authorized dependency upgrade when registry integrity mismatches", async () => {
    state.validDependencyFixture = true;

    const fixture = join(
      process.cwd(),
      "src/lib/remediation/__fixtures__/npm-braces-upgrade",
    );

    state.ingest.mockImplementation(async (repository: unknown) => {
      state.path = mkdtempSync(join(tmpdir(), "dg-remediation-bridge-"));

      writeFileSync(
        join(state.path, "package.json"),
        readFileSync(join(fixture, "package-before.json")),
      );

      writeFileSync(
        join(state.path, "package-lock.json"),
        readFileSync(join(fixture, "package-lock-before.json")),
      );

      return {
        repository,
        repositoryPath: state.path,
        provenance: state.provenance,
        cleanup() {
          rmSync(state.path, { recursive: true, force: true });
        },
      };
    });

    const updatedLock = JSON.parse(
      readFileSync(join(fixture, "package-lock-after.json"), "utf8"),
    );

    const target = updatedLock.packages["node_modules/braces"];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: "braces",
        version: "3.0.3",
        dist: {
          tarball: target.resolved,
          integrity: "sha512-" + "A".repeat(86) + "==",
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const dependencyProposal: FixProposal = {
      ...proposal,
      strategy: "dependency_security",
      packageName: "braces",
      advisoryId: "123",
      target: {
        checkId: "security",
        category: "security",
        evidenceIndexes: [0],
      },
    };

    const result = await runRemoteRemediation(
      "https://github.com/owner/repo",
      dependencyProposal,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.remediation.proof?.status).toBe("inconclusive");
    expect(result.remediation.verifiedArtifactReference).toBeUndefined();
    expect(result.remediation.verifiedPatch).toBeUndefined();
    expect(state.stored).toBeNull();
  });

  it("does not return a delivery reference when persisted metadata has the wrong repository", async () => {
    state.validDependencyFixture = true;
    state.corruptPersistedMetadata = true;
    const fixture = join(process.cwd(), "src/lib/remediation/__fixtures__/npm-braces-upgrade");
    state.ingest.mockImplementation(async (repository: unknown) => {
      state.path = mkdtempSync(join(tmpdir(), "dg-remediation-bridge-"));
      writeFileSync(join(state.path, "package.json"), readFileSync(join(fixture, "package-before.json")));
      writeFileSync(join(state.path, "package-lock.json"), readFileSync(join(fixture, "package-lock-before.json")));
      return { repository, repositoryPath: state.path, provenance: state.provenance,
        cleanup() { rmSync(state.path, { recursive: true, force: true }); } };
    });
    const updatedLock = JSON.parse(readFileSync(join(fixture, "package-lock-after.json"), "utf8"));
    const target = updatedLock.packages["node_modules/braces"];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      name: "braces", version: "3.0.3", dist: { tarball: target.resolved, integrity: target.integrity },
    }) }));
    const dependencyProposal: FixProposal = { ...proposal, strategy: "dependency_security",
      packageName: "braces", advisoryId: "123",
      target: { checkId: "security", category: "security", evidenceIndexes: [0] } };
    await expect(runRemoteRemediation("https://github.com/owner/repo", dependencyProposal))
      .rejects.toThrow("persistence could not be verified");
  });

  it("rejects dependency files changed during verification", async () => {
    state.mutateDuringVerification = true;
    state.ingest.mockImplementation(async (repository: unknown) => {
      state.path = mkdtempSync(join(tmpdir(), "dg-remediation-bridge-"));
      writeFileSync(join(state.path, "package-lock.json"), "{}");
      return { repository, repositoryPath: state.path, provenance: state.provenance,
        cleanup() { rmSync(state.path, { recursive: true, force: true }); } };
    });
    const dependencyProposal: FixProposal = { ...proposal, strategy: "dependency_security",
      packageName: "braces", advisoryId: "123",
      target: { checkId: "security", category: "security", evidenceIndexes: [0] } };
    const result = await runRemoteRemediation("https://github.com/owner/repo", dependencyProposal);
    expect(result.remediation.proof?.status).toBe("inconclusive");
    expect(result.remediation.verifiedArtifactReference).toBeUndefined();
    expect(state.stored).toBeNull();
  });
  for (const verified of [true, false]) {
    it(`${verified ? "accepts" : "rejects"} the exact persisted ID according to remote provenance`, async () => {
      state.provenance = { source: verified ? "verified-cache" : "fresh-ttl-cache",
        remoteVerified: verified, commitSha: "a".repeat(40), sourceBranch: "main" };
      state.ingest.mockImplementation(async (repository: unknown, _progress: unknown, factory: unknown) => {
        expect(factory).toBeTypeOf("function");
        const read = await (factory as (repository: unknown) => Promise<{ dispose?: () => Promise<void> | void }>)(repository);
        await read.dispose?.();
        state.path = mkdtempSync(join(tmpdir(), "dg-remediation-bridge-"));
        writeFileSync(join(state.path, "example.ts"), "export const value=1;\n");
        return { repository, repositoryPath: state.path, provenance: state.provenance,
          cleanup() { rmSync(state.path, { recursive: true, force: true }); } };
      });
      const result = await runRemoteRemediation("https://github.com/owner/repo", proposal,
        async () => ({ env: { GIT_CONFIG_PARAMETERS: "private-read-authority" }, dispose: state.dispose }));
      const reference = result.remediation.verifiedArtifactReference;
      expect(result.remediation.proof?.status).toBe("proven");
      expect(state.dispose).toHaveBeenCalledOnce();
      expect(reference?.artifactId).toBe(state.stored?.id);
      expect(reference?.deliveryEligible).toBe(verified);
      const authorize = vi.fn(async () => false);
      const claim = vi.fn();
      const request = new Request("https://deployguard.test/api/remediation/delivery", { method: "POST",
        headers: { origin: "https://deployguard.test" },
        body: JSON.stringify({ artifactId: reference?.artifactId, confirmDelivery: true }) });
      const response = await handleDeveloperDeliveryPost(request, { ...deliveryApiDependencies,
        session: () => ({ githubId: "1", login: "developer", expiresAt: Date.now() + 60_000 }),
        artifact: async (id) => id === state.stored?.id ? state.stored : null,
        authorize, claim });
      expect(response.status).toBe(verified ? 403 : 404);
      expect(authorize).toHaveBeenCalledTimes(verified ? 1 : 0);
      expect(claim).not.toHaveBeenCalled();
    });
  }
});
