import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { prisma } from "@/lib/database/prisma";
import { createRemediationBranchName } from "@/lib/remediation/git-delivery";
import { githubRemoteMatches, createGitHubAppPushTransport } from "@/lib/remediation/github-app-git-transport";
import { createInstallationAccessToken } from "@/lib/remediation/github-app-auth";
import { getRemediationDelivery } from "@/lib/remediation/remediation-delivery-repository";
import { getVerifiedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";
import { preparePersistedRemediationDelivery, commitPersistedRemediationDelivery, pushPersistedRemediationDelivery } from "@/lib/remediation/remediation-delivery-pipeline";

async function main() {
  if (process.env.DEPLOYGUARD_REAL_GITHUB_PUSH_TEST !== "1") {
    console.log("Skipped: set DEPLOYGUARD_REAL_GITHUB_PUSH_TEST=1 to opt in. No network or database changes made.");
    return;
  }
  const repositoryIdentity = "gevalinho/deployguard-ai";
  const repositoryPath = process.env.DEPLOYGUARD_PUSH_REPOSITORY_PATH;
  assert(repositoryPath, "DEPLOYGUARD_PUSH_REPOSITORY_PATH must identify an isolated clean checkout.");
  const path = resolve(repositoryPath);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  assert(githubRemoteMatches(repositoryIdentity, git("remote", "get-url", "origin")));
  assert.equal(git("status", "--porcelain"), "");
  const signingSecret = randomBytes(32).toString("hex");
  let deliveryId = process.env.DEPLOYGUARD_PUSH_DELIVERY_ID;
  if (!deliveryId) {
    // Reuse an existing verified artifact; never fabricate terminal database state.
    const artifactId = process.env.DEPLOYGUARD_PUSH_ARTIFACT_ID;
    assert(artifactId, "Provide DEPLOYGUARD_PUSH_DELIVERY_ID (COMMITTED) or DEPLOYGUARD_PUSH_ARTIFACT_ID (verified).");
    const sourceBranch = git("branch", "--show-current");
    const originalHead = git("rev-parse", "HEAD");
    assert(sourceBranch && !sourceBranch.startsWith("deployguard/"));
    const response = await fetch(`https://api.github.com/repos/${repositoryIdentity}/branches/${encodeURIComponent(sourceBranch)}`, {
      redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    assert(response.ok, "Unable to independently observe the source branch.");
    const source = await response.json() as { commit?: { sha?: string } };
    assert.equal(source.commit?.sha, originalHead);
    const prepared = await preparePersistedRemediationDelivery(path, repositoryIdentity, artifactId, signingSecret, { source: "fresh-remote", remoteVerified: true, sourceBranch, commitSha: originalHead });
    assert.equal(prepared.status, "prepared");
    assert(prepared.delivery);
    deliveryId = prepared.delivery.id;
    const committed = await commitPersistedRemediationDelivery(path, repositoryIdentity, deliveryId, signingSecret);
    assert.equal(committed.status, "committed");
    console.log(`Lifecycle fixture committed; deliveryId=${deliveryId}`);
  }
  const delivery = await getRemediationDelivery(deliveryId);
  assert(delivery && delivery.status === "COMMITTED" && delivery.commitSha);
  assert.equal(delivery.repositoryIdentity, repositoryIdentity);
  const artifact = await getVerifiedArtifactMetadata(delivery.artifactId);
  assert(artifact && artifact.repositoryIdentity === repositoryIdentity);
  assert.equal(delivery.branchName, createRemediationBranchName(artifact.sha256));
  assert.notEqual(delivery.branchName, delivery.sourceBranch);
  assert.equal(git("branch", "--show-current"), delivery.branchName);
  assert.equal(git("rev-parse", "HEAD"), delivery.commitSha);
  // Print the complete mutation scope BEFORE token acquisition or remote push.
  console.log(JSON.stringify({ repositoryIdentity, sourceBranch: delivery.sourceBranch,
    remediationBranch: delivery.branchName, commitSha: delivery.commitSha }, null, 2));
  let issued = false;
  const transport = createGitHubAppPushTransport(async (owner, repository) => {
    const access = await createInstallationAccessToken(owner, repository);
    assert.equal(access.repositoryIdentity, repositoryIdentity);
    assert(access.installationId > 0);
    issued = true;
    console.log("✓ Installation resolved and repository-scoped App token acquired.");
    return access;
  });
  const result = await pushPersistedRemediationDelivery(path, repositoryIdentity, deliveryId, "origin", signingSecret, transport);
  assert(issued);
  assert.equal(result.status, "pushed", result.summary);
  assert.equal(result.gitPush?.commitSha, delivery.commitSha);
  // The executor used a separate authenticated ls-remote before persisting PUSHED.
  const stored = await getRemediationDelivery(deliveryId);
  assert.equal(stored?.status, "PUSHED");
  assert.equal(stored?.commitSha, delivery.commitSha);
  console.log("✓ Exact authorized commit pushed with App authority; GitHub branch independently verified; durable state is PUSHED. No PR created.");
}
main().catch(() => {
  // Never print raw errors from Git, fetch, assertions, or credential providers.
  console.error("Real GitHub App push test failed. Check configuration, fixture, and durable delivery state before retrying.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
