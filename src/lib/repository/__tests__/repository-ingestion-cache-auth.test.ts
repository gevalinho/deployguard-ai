import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { runCommand } = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock("@/lib/execution/command-runner", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/execution/command-runner")>(), runCommand,
}));

const originalCwd = process.cwd();
let root: string | undefined;
afterEach(() => {
  process.chdir(originalCwd);
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
  vi.resetModules();
  runCommand.mockReset();
});

describe("authenticated cache revalidation", () => {
  it("retains ingestion workspace when a child process cannot confirm exit", async () => {
    root = mkdtempSync(join(tmpdir(), "dg-unconfirmed-child-"));
    process.chdir(root);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { CommandTerminationUnconfirmedError } = await import("@/lib/execution/command-runner");
    const { ingestGitHubRepository } = await import("@/lib/repository/repository-ingestion");
    runCommand.mockRejectedValue(new CommandTerminationUnconfirmedError(43210));
    const repo = { owner: "owner", name: "repo", fullName: "owner/repo",
      url: "https://github.com/owner/repo", cloneUrl: "https://github.com/owner/repo.git" };
    await expect(ingestGitHubRepository(repo)).rejects.toMatchObject({ outcome: {
      reason: "assessment_cleanup_unconfirmed", retryable: false } });
    const workspaces = join(root, ".deployguard", "workspaces");
    expect(readdirSync(workspaces)).toHaveLength(1);
    const record = log.mock.calls.find(([message]) =>
      message === "[Repository Ingestion] Child process termination unconfirmed; workspace retained.");
    const directory = (record?.[1] as { ownershipDirectory?: string } | undefined)?.ownershipDirectory;
    expect(directory).toEqual(expect.any(String));
    rmSync(directory!, { recursive: true, force: true });
    log.mockRestore();
  });
  it("removes the temporary workspace if GitHub token acquisition fails", async () => {
    root = mkdtempSync(join(tmpdir(), "dg-token-failure-"));
    process.chdir(root);
    const { ingestGitHubRepository } = await import("@/lib/repository/repository-ingestion");
    const repo = { owner: "owner", name: "repo", fullName: "owner/repo",
      url: "https://github.com/owner/repo", cloneUrl: "https://github.com/owner/repo.git" };
    const factory = vi.fn().mockRejectedValue(new Error("GitHub token unavailable"));
    await expect(ingestGitHubRepository(repo, undefined, factory)).rejects.toThrow("GitHub token unavailable");
    expect(factory).toHaveBeenCalledOnce();
    const workspaces = join(root, ".deployguard", "workspaces");
    expect(existsSync(workspaces)).toBe(true);
    expect(readdirSync(workspaces)).toEqual([]);
  });

  for (const verified of [true, false]) {
    it(`${verified ? "accepts" : "rejects"} remote identity using only Git read credentials`, async () => {
      root = mkdtempSync(join(tmpdir(), "dg-cache-auth-"));
      process.chdir(root);
      const cache = join(root, ".deployguard", "cache", "repositories", "owner--repo");
      mkdirSync(join(cache, "repository"), { recursive: true });
      writeFileSync(join(cache, "repository", "package.json"), "{}");
      writeFileSync(join(cache, "metadata.json"), JSON.stringify({
        repository: "owner/repo", contentIdentityVerified: true, cachedAt: new Date().toISOString(),
        commitSha: "a".repeat(40), sourceBranch: "main",
      }));
      runCommand.mockResolvedValue(verified ? {
        status: "passed", stdout: `ref: refs/heads/main\tHEAD\n${"a".repeat(40)}\tHEAD\n`, stderr: "",
      } : { status: "failed", stdout: "", stderr: "" });
      const { ingestGitHubRepository } = await import("@/lib/repository/repository-ingestion");
      const dispose = vi.fn();
      const factory = vi.fn(async () => ({ env: { GIT_CONFIG_PARAMETERS: "private-read-authority" }, dispose }));
      const repo = { owner: "owner", name: "repo", fullName: "owner/repo",
        url: "https://github.com/owner/repo", cloneUrl: "https://github.com/owner/repo.git" };
      const ingestion = await ingestGitHubRepository(repo, undefined, factory);
      try {
        expect(factory).toHaveBeenCalledWith(repo);
        expect(runCommand).toHaveBeenCalledWith("git", expect.arrayContaining(["ls-remote"]), expect.any(String),
          expect.objectContaining({ env: expect.objectContaining({ GIT_CONFIG_PARAMETERS: "private-read-authority" }), inheritProcessEnv: false }));
        expect(ingestion.provenance.source).toBe(verified ? "verified-cache" : "fresh-ttl-cache");
        expect(ingestion.provenance.remoteVerified).toBe(verified);
        expect(dispose).toHaveBeenCalledOnce();
      } finally {
        ingestion.cleanup();
      }
    });
  }

  it("refetches an unverified cache when authenticated remote identity is available", async () => {
    root = mkdtempSync(join(tmpdir(), "dg-cache-auth-"));
    process.chdir(root);
    const cache = join(root, ".deployguard", "cache", "repositories", "owner--repo");
    mkdirSync(join(cache, "repository"), { recursive: true });
    writeFileSync(join(cache, "repository", "package.json"), "{}");
    writeFileSync(join(cache, "metadata.json"), JSON.stringify({ repository: "owner/repo",
      contentIdentityVerified: false, cachedAt: new Date().toISOString(),
      commitSha: "a".repeat(40), sourceBranch: "main" }));
    runCommand.mockImplementation(async (command: string, args: string[]) => {
      if (command === "git" && args[0] === "ls-remote") return { status: "passed",
        stdout: `ref: refs/heads/main\tHEAD\n${"a".repeat(40)}\tHEAD\n`, stderr: "" };
      if (command === "curl") return { status: "failed", stdout: "", stderr: "" };
      if (command === "git" && args[0] === "clone") {
        mkdirSync(args.at(-1)!, { recursive: true });
        writeFileSync(join(args.at(-1)!, "package.json"), "{}");
        return { status: "passed", stdout: "", stderr: "" };
      }
      if (command === "git" && args[0] === "rev-parse") return { status: "passed", stdout: `${"a".repeat(40)}\n`, stderr: "" };
      if (command === "git" && args[0] === "branch") return { status: "passed", stdout: "main\n", stderr: "" };
      throw new Error(`Unexpected command: ${command} ${args[0]}`);
    });
    const { ingestGitHubRepository } = await import("@/lib/repository/repository-ingestion");
    const dispose = vi.fn();
    const ingestion = await ingestGitHubRepository({ owner: "owner", name: "repo", fullName: "owner/repo",
      url: "https://github.com/owner/repo", cloneUrl: "https://github.com/owner/repo.git" }, undefined,
    async () => ({ env: { GIT_CONFIG_PARAMETERS: "private-read-authority" }, dispose }));
    try {
      expect(ingestion.provenance.source).toBe("fresh-remote");
      expect(ingestion.provenance.remoteVerified).toBe(true);
      expect(runCommand).toHaveBeenCalledWith("git", expect.arrayContaining(["clone"]), expect.any(String),
        expect.objectContaining({ env: expect.objectContaining({ GIT_CONFIG_PARAMETERS: "private-read-authority" }) }));
      expect(dispose).toHaveBeenCalledOnce();
    } finally { ingestion.cleanup(); }
  });
});
