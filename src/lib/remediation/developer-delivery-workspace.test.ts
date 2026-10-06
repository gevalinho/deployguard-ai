import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync } from "node:fs";
import type { TrustedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";
import type { GitHubRepository } from "@/lib/repository/github-repository";

const state = vi.hoisted(() => ({ ingest: vi.fn(), git: vi.fn() }));
vi.mock("@/lib/repository/repository-ingestion", () => ({ ingestGitHubRepository: state.ingest }));
vi.mock("node:child_process", () => {
  const execFile = Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: state.git });
  return { execFile };
});

import { createDeveloperDeliveryWorkspace, verifyCurrentRepositoryProvenance } from "./developer-delivery-workspace";

const artifact: TrustedArtifactMetadata = {
  id: "artifact123", repositoryIdentity: "owner/private-repo", format: "unified_diff",
  sha256: "b".repeat(64), byteSize: 10, createdAt: new Date(),
  sourceCommitSha: "a".repeat(40), sourceBranch: "master",
  ingestionSource: "verified-cache", ingestionRemoteVerified: true,
};
const verified = { source: "verified-cache", remoteVerified: true, commitSha: artifact.sourceCommitSha,
  sourceBranch: artifact.sourceBranch };

let disposals: Array<ReturnType<typeof vi.fn>> = [];
let expectedIdentity = "owner/private-repo";
const factory = vi.fn(async (_repository: GitHubRepository) => {
  expect(_repository.fullName).toBe(expectedIdentity);
  const dispose = vi.fn(async () => {});
  disposals.push(dispose);
  return { env: { GIT_CONFIG_PARAMETERS: "private-read-authority" }, dispose };
});

beforeEach(() => {
  expectedIdentity = "owner/private-repo";
  state.ingest.mockReset(); state.git.mockReset(); factory.mockClear(); disposals = [];
  state.ingest.mockImplementation(async (repository, _progress, readFactory) => {
    const read = await readFactory(repository);
    await read.dispose();
    return { repository, repositoryPath: "/unused", provenance: verified, cleanup: vi.fn() };
  });
  state.git.mockImplementation(async (_command: string, args: string[], options: { env: Record<string, string> }) => {
    if (args[0] === "clone") {
      expect(options.env.GIT_CONFIG_PARAMETERS).toBe("private-read-authority");
      mkdirSync(args.at(-1)!, { recursive: true });
      return { stdout: "", stderr: "" };
    }
    expect(options.env.GIT_CONFIG_PARAMETERS).toBeUndefined();
    if (args[0] === "rev-parse") return { stdout: `${artifact.sourceCommitSha}\n`, stderr: "" };
    if (args[0] === "branch") return { stdout: "master\n", stderr: "" };
    if (args[0] === "remote") return { stdout: `https://github.com/${expectedIdentity}.git\n`, stderr: "" };
    return { stdout: "", stderr: "" };
  });
});
afterEach(() => { state.ingest.mockReset(); state.git.mockReset(); });

describe("private delivery workspace read authority", () => {
  it("uses repository-scoped read authority for verification and clone, then disposes both", async () => {
    const workspace = await createDeveloperDeliveryWorkspace(artifact, factory);
    try {
      expect(workspace.provenance).toEqual(verified);
      expect(factory).toHaveBeenCalledTimes(2);
      for (const [repository] of factory.mock.calls) expect(repository.fullName).toBe(artifact.repositoryIdentity);
      expect(disposals).toHaveLength(2);
      for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
      expect(state.git).toHaveBeenCalledWith("git", expect.arrayContaining(["clone"]), expect.any(Object));
    } finally { await workspace.cleanup(); }
  });

  it("preserves delivery checkout behavior for an authorized public repository", async () => {
    expectedIdentity = "owner/public-repo";
    const workspace = await createDeveloperDeliveryWorkspace({ ...artifact,
      repositoryIdentity: expectedIdentity }, factory);
    try {
      expect(workspace.provenance).toEqual(verified);
      expect(factory).toHaveBeenCalledTimes(2);
      for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    } finally { await workspace.cleanup(); }
  });

  for (const provenance of [
    { ...verified, source: "stale-fallback-cache" },
    { ...verified, remoteVerified: false },
    { ...verified, commitSha: "c".repeat(40) },
    { ...verified, sourceBranch: "main" },
  ]) {
    it(`rejects mismatched provenance before clone: ${JSON.stringify(provenance)}`, async () => {
      state.ingest.mockImplementationOnce(async (repository, _progress, readFactory) => {
        const read = await readFactory(repository); await read.dispose();
        return { repository, repositoryPath: "/unused", provenance, cleanup: vi.fn() };
      });
      await expect(createDeveloperDeliveryWorkspace(artifact, factory)).rejects.toThrow("Remote provenance mismatch.");
      expect(state.git).not.toHaveBeenCalled();
      expect(disposals).toHaveLength(1);
      expect(disposals[0]).toHaveBeenCalledOnce();
    });
  }

  it("disposes checkout credentials if private clone fails", async () => {
    state.git.mockRejectedValueOnce(new Error("Clone failed"));
    await expect(createDeveloperDeliveryWorkspace(artifact, factory)).rejects.toThrow("Clone failed");
    expect(disposals).toHaveLength(2);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it("authenticates the final pre-push provenance recheck", async () => {
    expect(await verifyCurrentRepositoryProvenance(artifact, factory)).toBe(true);
    expect(factory).toHaveBeenCalledOnce();
    expect(disposals[0]).toHaveBeenCalledOnce();
  });
});
