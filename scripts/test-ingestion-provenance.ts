import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const originalCwd = process.cwd();
const require = createRequire(join(originalCwd, "package.json"));
const root = mkdtempSync(join(tmpdir(), "dg-ingestion-provenance-"));
const sha = "a".repeat(40);
let remoteAvailable = true;
let archiveAvailable = true;
let clonedHead = sha;
let observations = 0;
const downloads: string[] = [];
const commandId = require.resolve("@/lib/execution/command-runner");
const cachedModule = new Module(commandId);
cachedModule.exports = {
  async runCommand(command: string, args: string[], cwd: string) {
    const passed = (stdout = "") => ({ status: "passed", stdout, stderr: "" });
    if (command === "git" && args[0] === "ls-remote") {
      observations++;
      return remoteAvailable ? passed(`ref: refs/heads/main\tHEAD\n${sha}\tHEAD\n`) : { status: "failed", stdout: "", stderr: "" };
    }
    if (command === "curl") {
      downloads.push(args.at(-1)!);
      if (!archiveAvailable) return { status: "failed", stdout: "", stderr: "" };
      writeFileSync(args[args.indexOf("--output") + 1], "archive fixture");
      return passed();
    }
    if (command === "tar") {
      mkdirSync(join(cwd, "repository"), { recursive: true });
      writeFileSync(join(cwd, "repository/example.ts"), "verified source\n");
      return passed();
    }
    if (command === "git" && args[0] === "clone") {
      mkdirSync(args.at(-1)!, { recursive: true });
      writeFileSync(join(args.at(-1)!, "example.ts"), "cloned source\n");
      return passed();
    }
    if (command === "git" && args[0] === "rev-parse") return passed(clonedHead);
    if (command === "git" && args[0] === "branch") return passed("main");
    throw new Error(`Unexpected ingestion command: ${command} ${args[0]}`);
  },
};
require.cache[commandId] = cachedModule;
process.chdir(root);
const { ingestGitHubRepository } = require("@/lib/repository/repository-ingestion") as typeof import("@/lib/repository/repository-ingestion");
const { parseGitHubRepositoryUrl } = require("@/lib/repository/github-repository") as typeof import("@/lib/repository/github-repository");
const repository = parseGitHubRepositoryUrl("https://github.com/owner/repo");
const cacheRoot = join(root, ".deployguard/cache/repositories/owner--repo");
const metadataPath = join(cacheRoot, "metadata.json");
async function main() {
  try {
    const fresh = await ingestGitHubRepository(repository);
    assert.equal(fresh.provenance.remoteVerified, true);
    assert.equal(fresh.provenance.commitSha, sha);
    assert.equal(fresh.provenance.sourceBranch, "main");
    assert.equal(downloads[0], `https://api.github.com/repos/owner/repo/tarball/${sha}`);
    assert.equal(observations, 1, "Cache must preserve the fetched identity, not re-observe a moving HEAD");
    fresh.cleanup(); assert(!existsSync(fresh.repositoryPath));
    const verified = await ingestGitHubRepository(repository);
    assert.equal(verified.provenance.source, "verified-cache");
    assert.equal(verified.provenance.remoteVerified, true);
    verified.cleanup();
    remoteAvailable = false;
    const ttl = await ingestGitHubRepository(repository);
    assert.equal(ttl.provenance.source, "fresh-ttl-cache");
    assert.equal(ttl.provenance.remoteVerified, false);
    ttl.cleanup();
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    metadata.cachedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    writeFileSync(metadataPath, JSON.stringify(metadata));
    const stale = await ingestGitHubRepository(repository);
    assert.equal(stale.provenance.source, "stale-fallback-cache");
    assert.equal(stale.provenance.remoteVerified, false);
    stale.cleanup();
    remoteAvailable = true;
    delete metadata.contentIdentityVerified;
    metadata.cachedAt = new Date().toISOString();
    writeFileSync(metadataPath, JSON.stringify(metadata));
    const legacy = await ingestGitHubRepository(repository);
    assert.equal(legacy.provenance.remoteVerified, false, "Legacy unbound cache must not gain delivery authority");
    legacy.cleanup();
    rmSync(cacheRoot, { recursive: true, force: true });
    archiveAvailable = false;
    clonedHead = "b".repeat(40);
    const raced = await ingestGitHubRepository(repository);
    assert.equal(raced.provenance.remoteVerified, false);
    assert.equal(raced.provenance.commitSha, undefined);
    assert.equal(JSON.parse(readFileSync(metadataPath, "utf8")).contentIdentityVerified, false);
    raced.cleanup();
    console.log("✓ Ingestion pins archives and rejects TTL, stale, legacy, and mismatched clone provenance as authority.");
  } finally {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
