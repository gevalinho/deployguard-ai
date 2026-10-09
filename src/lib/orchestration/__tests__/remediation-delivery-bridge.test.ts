import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TrustedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";
import type { FixProposal } from "@/lib/remediation/types";

const state = vi.hoisted(() => ({
  provenance: { source: "verified-cache", remoteVerified: true, commitSha: "a".repeat(40), sourceBranch: "main" },
  stored: null as TrustedArtifactMetadata | null,
  path: "",
  dispose: vi.fn(),
  ingest: vi.fn(),
  mutateDuringVerification: false,
  twoAdvisories: false,
  duplicateEvidenceIdentity: false,
  invalidFindingType: false,
  missingEvidenceIdentity: false,
}));
vi.mock("@/lib/repository/repository-ingestion", () => ({ ingestGitHubRepository: state.ingest }));
vi.mock("@/lib/sandbox/workspace-preparation", () => ({ prepareSandboxWorkspace: async (...args: unknown[]) => {
  expect(args).toHaveLength(1);
  expect(JSON.stringify(args)).not.toContain("private-read-authority");
  return { status: "passed" };
} }));
vi.mock("@/lib/agents/sandbox-typecheck-agent", () => ({ runSandboxTypecheckAgent: async () => ({ id: "types", status: "passed", category: "types", name: "Types", summary: "Passed" }) }));
vi.mock("@/lib/agents/sandbox-test-agent", () => ({ runSandboxTestAgent: async () => ({ id: "tests", status: "passed", category: "tests", name: "Tests", summary: "Passed" }) }));
vi.mock("@/lib/agents/sandbox-build-agent", () => ({ runSandboxBuildAgent: async () => ({ id: "build", status: "passed", category: "build", name: "Build", summary: "Passed" }) }));
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
  runSandboxSecurityAgent: async () => ({
    id: "security", status: "failed", category: "security", name: "Security", summary: "Finding",
    evidence: [{ kind: state.invalidFindingType ? "diagnostic" : "security_finding", code: "high",
      message: "braces has a high-severity dependency vulnerability.",
      advisoryIds: state.missingEvidenceIdentity ? undefined : state.duplicateEvidenceIdentity ? ["123", "123"] :
        state.twoAdvisories ? ["123", "456"] : ["123"] },
      ...(state.twoAdvisories ? [{ kind: "security_finding", code: "high",
        message: "other has a high-severity dependency vulnerability.", advisoryIds: ["789"] }] : [])],
  }),
}));
vi.mock("@/lib/remediation/dependency-security-fixer", () => ({ applyDependencySecurityFix: async (path: string) => {
  writeFileSync(join(path, "package-lock.json"), '{"changed":true}');
  return { status: "applied", summary: "Attempted" };
} }));
vi.mock("@/lib/remediation/dependency-security-verifier", () => ({ verifyDependencySecurityFix: async (path: string) => {
  if (state.mutateDuringVerification) writeFileSync(join(path, "package-lock.json"), '{"unexpected":true}');
  return { status: "proven", summary: "Verified", comparisons: [], regressionChecks: [] };
} }));
vi.mock("@/lib/remediation/trusted-artifact-repository", () => ({
  persistVerifiedArtifact: async (identity: string, artifact: { sha256: string; byteSize: number; format: string },
    provenance: typeof state.provenance) => {
    state.stored = { id: "artifact123", repositoryIdentity: identity, sha256: artifact.sha256,
      byteSize: artifact.byteSize, format: artifact.format, createdAt: new Date(),
      sourceCommitSha: provenance.commitSha, sourceBranch: provenance.sourceBranch,
      ingestionSource: provenance.source, ingestionRemoteVerified: provenance.remoteVerified };
    return state.stored;
  },
  getVerifiedArtifactMetadata: async (id: string) => id === state.stored?.id ? state.stored : null,
}));

import { runRemoteRemediation } from "@/lib/orchestration/remediation-orchestrator";
import { deliveryApiDependencies, handleDeveloperDeliveryPost } from "@/lib/remediation/developer-delivery-api";

const proposal: FixProposal = { id: "lint-fix", title: "Fix lint", description: "Controlled fix", strategy: "lint_autofix",
  risk: "safe", target: { checkId: "lint", category: "lint", evidenceIndexes: [] } };

afterEach(() => {
  if (state.path) rmSync(state.path, { recursive: true, force: true });
  state.path = "";
  state.stored = null;
  state.dispose.mockReset();
  state.ingest.mockReset();
  state.mutateDuringVerification = false;
  state.twoAdvisories = false;
  state.duplicateEvidenceIdentity = false;
  state.invalidFindingType = false;
  state.missingEvidenceIdentity = false;
});

describe("proven remediation to immediate delivery lookup", () => {
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
    expect((await runRemoteRemediation("https://github.com/owner/repo", base)).remediation.proof?.status).toBe("proven");
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
    expect(result.remediation.proof?.status).toBe("proven");
    expect(result.remediation.verifiedArtifactReference).toBeUndefined();
    expect(state.stored).toBeNull();
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
