import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseGitHubRepositoryUrl } from "@/lib/repository/github-repository";
import { ingestGitHubRepository, type RepositoryIngestionProvenance } from "@/lib/repository/repository-ingestion";
import { githubRemoteMatches } from "@/lib/remediation/github-app-git-transport";
import { matchesVerifiedArtifactProvenance } from "@/lib/remediation/artifact-delivery-reference";
import type { TrustedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";

const run = promisify(execFile);
export function validDeliverySourceBranch(branch: string): boolean {
  return /^(?!-)[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) && !branch.includes("..") &&
    !branch.includes("//") && !branch.endsWith("/") && !branch.endsWith(".") && !branch.includes("@{");
}
export interface DeliveryWorkspace { path: string; provenance: RepositoryIngestionProvenance; cleanup: () => Promise<void> }
export async function createDeveloperDeliveryWorkspace(artifact: TrustedArtifactMetadata): Promise<DeliveryWorkspace> {
  const repository = parseGitHubRepositoryUrl(`https://github.com/${artifact.repositoryIdentity}`);
  if (repository.fullName !== artifact.repositoryIdentity || !artifact.sourceBranch || !validDeliverySourceBranch(artifact.sourceBranch))
    throw new Error("Invalid persisted repository identity.");
  const ingestion = await ingestGitHubRepository(repository);
  let directory: string | null = null;
  try {
    if (!matchesVerifiedArtifactProvenance(artifact, ingestion.provenance)) throw new Error("Remote provenance mismatch.");
    directory = await mkdtemp(join(tmpdir(), "deployguard-delivery-"));
    const path = join(directory, "repository");
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV, HOME: directory,
      XDG_CONFIG_HOME: directory, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "https" };
    await run("git", ["clone", "--no-tags", "--depth", "1", "--single-branch", "--branch", artifact.sourceBranch,
      "--", repository.cloneUrl, path], { cwd: directory, env, timeout: 6 * 60_000 });
    const git = async (...args: string[]) => (await run("git", args, { cwd: path, env, timeout: 30_000 })).stdout.trim();
    const [head, branch, remote, status] = await Promise.all([
      git("rev-parse", "HEAD"), git("branch", "--show-current"), git("remote", "get-url", "origin"), git("status", "--porcelain"),
    ]);
    if (head !== artifact.sourceCommitSha || branch !== artifact.sourceBranch ||
      !githubRemoteMatches(artifact.repositoryIdentity, remote) || status) throw new Error("Delivery checkout identity mismatch.");
    await git("config", "--local", "user.name", "DeployGuard AI");
    await git("config", "--local", "user.email", "deployguard[bot]@users.noreply.github.com");
    return { path, provenance: ingestion.provenance, cleanup: async () => { await rm(directory!, { recursive: true, force: true }); } };
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error;
  } finally { ingestion.cleanup(); }
}

export async function verifyCurrentRepositoryProvenance(artifact: TrustedArtifactMetadata): Promise<boolean> {
  const repository = parseGitHubRepositoryUrl(`https://github.com/${artifact.repositoryIdentity}`);
  if (repository.fullName !== artifact.repositoryIdentity) return false;
  const ingestion = await ingestGitHubRepository(repository);
  try { return matchesVerifiedArtifactProvenance(artifact, ingestion.provenance); }
  finally { ingestion.cleanup(); }
}
