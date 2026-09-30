import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { matchesVerifiedArtifactProvenance } from "@/lib/remediation/artifact-delivery-reference";
import { prisma } from "@/lib/database/prisma";
import { createRemediationBranchName } from "@/lib/remediation/git-delivery";
import { githubRemoteMatches, createGitHubAppPushTransport } from "@/lib/remediation/github-app-git-transport";
import { createInstallationAccessToken } from "@/lib/remediation/github-app-auth";
import { getRemediationDelivery } from "@/lib/remediation/remediation-delivery-repository";
import { getVerifiedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";
import { preparePersistedRemediationDelivery, commitPersistedRemediationDelivery, pushPersistedRemediationDelivery } from "@/lib/remediation/remediation-delivery-pipeline";

type Stage = "configuration" | "checkout_identity" | "artifact_lookup" |
  "remote_provenance" | "prepare_delivery" | "commit_delivery" |
  "delivery_lookup" | "delivery_validation" | "github_app_authorization" |
  "transport_setup" | "push_delivery" | "remote_verification" |
  "persist_delivery" | "durable_verification" | "cleanup";

type SetStage = (stage: Stage) => void;

async function main(setStage: SetStage) {
  if (process.env.DEPLOYGUARD_REAL_GITHUB_PUSH_TEST !== "1") {
    console.log("Skipped: set DEPLOYGUARD_REAL_GITHUB_PUSH_TEST=1 to opt in. No network or database changes made.");
    return;
  }
  const repositoryIdentity = process.env.DEPLOYGUARD_PUSH_REPOSITORY_IDENTITY;
  // Require an exact identity, never a URL, credential, or inferred default.
  assert(repositoryIdentity && repositoryIdentity === repositoryIdentity.trim() &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/.test(repositoryIdentity) &&
    ![".", ".."].includes(repositoryIdentity.split("/")[1]),
  "DEPLOYGUARD_PUSH_REPOSITORY_IDENTITY must be exactly owner/repository.");
  const repositoryPath = process.env.DEPLOYGUARD_PUSH_REPOSITORY_PATH;
  assert(repositoryPath, "DEPLOYGUARD_PUSH_REPOSITORY_PATH must identify an isolated clean checkout.");
  console.log("✓ configuration validated");
  setStage("checkout_identity");
  const path = resolve(repositoryPath);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  assert(githubRemoteMatches(repositoryIdentity, git("remote", "get-url", "origin")));
  assert.equal(git("status", "--porcelain"), "");
  console.log("✓ checkout identity verified");
  const signingSecret = randomBytes(32).toString("hex");
  let deliveryId = process.env.DEPLOYGUARD_PUSH_DELIVERY_ID;
  if (!deliveryId) {
    // Reuse an existing verified artifact; never fabricate terminal database state.
    setStage("configuration");
    const artifactId = process.env.DEPLOYGUARD_PUSH_ARTIFACT_ID;
    assert(artifactId, "Provide DEPLOYGUARD_PUSH_DELIVERY_ID (COMMITTED) or DEPLOYGUARD_PUSH_ARTIFACT_ID (verified).");
    setStage("artifact_lookup");
    const persistedArtifact = await getVerifiedArtifactMetadata(artifactId);
    assert(persistedArtifact && persistedArtifact.repositoryIdentity === repositoryIdentity);
    console.log("✓ database/artifact loaded");
    setStage("checkout_identity");
    const sourceBranch = git("branch", "--show-current");
    const originalHead = git("rev-parse", "HEAD");
    assert(sourceBranch && !sourceBranch.startsWith("deployguard/"));
    setStage("remote_provenance");
    const response = await fetch(`https://api.github.com/repos/${repositoryIdentity}/branches/${encodeURIComponent(sourceBranch)}`, {
      redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    assert(response.ok, "Unable to independently observe the source branch.");
    const source = await response.json() as { name?: string; commit?: { sha?: string } };
    assert.equal(source.name, sourceBranch);
    assert.equal(source.commit?.sha, originalHead);
    const provenance = { source: "fresh-remote" as const, remoteVerified: true, sourceBranch, commitSha: originalHead };
    assert(matchesVerifiedArtifactProvenance(persistedArtifact, provenance));
    console.log("✓ remote provenance verified");
    setStage("prepare_delivery");
    console.log("→ preparing delivery");
    const prepared = await preparePersistedRemediationDelivery(path, repositoryIdentity, artifactId, signingSecret, provenance);
    assert.equal(prepared.status, "prepared");
    assert(prepared.delivery);
    deliveryId = prepared.delivery.id;
    console.log("✓ delivery prepared");
    setStage("commit_delivery");
    console.log("→ committing delivery");
    const committed = await commitPersistedRemediationDelivery(path, repositoryIdentity, deliveryId, signingSecret);
    assert.equal(committed.status, "committed");
    console.log("✓ delivery committed");
  }
  setStage("delivery_lookup");
  const delivery = await getRemediationDelivery(deliveryId);
  assert(delivery && delivery.status === "COMMITTED" && delivery.commitSha);
  assert.equal(delivery.repositoryIdentity, repositoryIdentity);
  setStage("artifact_lookup");
  const artifact = await getVerifiedArtifactMetadata(delivery.artifactId);
  assert(artifact && artifact.repositoryIdentity === repositoryIdentity);
  console.log("✓ database/artifact loaded");
  setStage("delivery_validation");
  assert.equal(delivery.branchName, createRemediationBranchName(artifact.sha256));
  assert.notEqual(delivery.branchName, delivery.sourceBranch);
  assert.notEqual(delivery.branchName, "main");
  assert.equal(git("branch", "--show-current"), delivery.branchName);
  assert.equal(git("rev-parse", "HEAD"), delivery.commitSha);
  console.log("✓ committed delivery identity verified");
  let issued = false;
  const openTransport = createGitHubAppPushTransport(async (owner, repository) => {
    setStage("github_app_authorization");
    console.log("→ acquiring GitHub App installation authorization");
    const access = await createInstallationAccessToken(owner, repository);
    assert.equal(access.repositoryIdentity, repositoryIdentity);
    assert(access.installationId > 0);
    issued = true;
    console.log("✓ GitHub App authorization acquired");
    setStage("transport_setup");
    return access;
  });
  // Observe the authorized executor's commands; never issue additional Git
  // commands, alter arguments/results, or treat logging as delivery authority.
  const transport: typeof openTransport = async (scope) => {
    setStage("transport_setup");
    const opened = await openTransport(scope);
    return {
      ...opened,
      async run(args) {
        if (args[0] === "push") {
          setStage("push_delivery");
          console.log("→ pushing remediation branch");
        } else if (args[0] === "ls-remote") {
          setStage("remote_verification");
          console.log("→ verifying remote branch");
        }
        const result = await opened.run(args);
        if (args[0] === "push" && result.status === "passed") {
          console.log("✓ remediation branch pushed");
        }
        if (args[0] === "ls-remote" && result.status === "passed" &&
            result.stdout.trim() === `${delivery.commitSha}\trefs/heads/${delivery.branchName}`) {
          console.log("✓ remote branch verified");
          setStage("persist_delivery");
        }
        return result;
      },
    };
  };
  setStage("push_delivery");
  const result = await pushPersistedRemediationDelivery(path, repositoryIdentity, deliveryId, "origin", signingSecret, transport);
  assert(issued);
  if (result.status === "persistence_failed") setStage("persist_delivery");
  assert.equal(result.status, "pushed");
  assert.equal(result.gitPush?.commitSha, delivery.commitSha);
  // The executor used a separate authenticated ls-remote before persisting PUSHED.
  setStage("durable_verification");
  const stored = await getRemediationDelivery(deliveryId);
  assert.equal(stored?.status, "PUSHED");
  assert.equal(stored?.commitSha, delivery.commitSha);
  console.log("✓ Exact authorized commit pushed with App authority; GitHub branch independently verified; durable state is PUSHED. No PR created.");
}
/** Importing for stubbed harness tests never starts the real integration. */
export async function runRealGitHubAppPushTest(): Promise<boolean> {
  let stage: Stage = "configuration";
  let passed = false;
  try {
    await main((next) => { stage = next; });
    passed = true;
  } catch {
    // Only a closed, harness-owned identifier is emitted. Never inspect the
    // error, provider summary, command output, environment, or transport URL.
    console.error(`FAILED_STAGE=${stage}`);
  }
  try {
    await prisma.$disconnect();
  } catch {
    // Cleanup errors must neither leak raw errors nor replace the first failure.
    if (passed) console.error("FAILED_STAGE=cleanup");
    passed = false;
  }
  return passed;
}

if (require.main === module) {
  void runRealGitHubAppPushTest().then((passed) => {
    if (!passed) process.exitCode = 1;
  });
}
