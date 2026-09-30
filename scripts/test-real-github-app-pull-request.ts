import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/database/prisma";
import { createInstallationAccessToken } from "@/lib/remediation/github-app-auth";
import { issueGitHubPullRequestCapability, signGitHubPullRequestCapability } from "@/lib/remediation/github-pull-request-capability";
import { createVerifiedGitHubPullRequest } from "@/lib/remediation/github-pull-request-delivery";
import { createRemediationBranchName } from "@/lib/remediation/git-delivery";
import { getRemediationDelivery } from "@/lib/remediation/remediation-delivery-repository";
import { getVerifiedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";

// This first real test is deliberately pinned to the independently verified
// fixture and delivery. It cannot be retargeted with arbitrary input.
const REPOSITORY = "gevalinho/deployguard-lint-fixture";
const DELIVERY_ID = "cmunyaeb30001wd0jxifmmbw9";
const BASE_SHA = "b33ebd64a696b5792e0cd459161fb2f8bc319125";
const HEAD_BRANCH = "deployguard/remediation-9c9b23d4566b";
const HEAD_SHA = "57b64cc5fd7452ab9daf3b34253a45c9cee4a0e6";
const ARTIFACT_SHA = "9c9b23d4566b966be68e4be67469c63c8f8aced4c3be61b2bf0778d2541a0150";
const API = `https://api.github.com/repos/${REPOSITORY}`;

type Stage = "configuration" | "delivery_lookup" | "artifact_lookup" |
  "remote_identity" | "github_app_authorization" | "existing_pr_check" |
  "capability" | "create_pr" | "remote_verification" | "cleanup";
type SetStage = (stage: Stage) => void;

type Branch = { name?: unknown; commit?: { sha?: unknown } };
type Pull = { number?: unknown; html_url?: unknown;
  head?: { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } };
  base?: { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } } };

async function readGitHub(path: string, token?: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

function matchesPull(value: Pull, number: number): boolean {
  return value.number === number &&
    value.html_url === `https://github.com/${REPOSITORY}/pull/${number}` &&
    value.head?.ref === HEAD_BRANCH && value.head.sha === HEAD_SHA &&
    value.head.repo?.full_name === REPOSITORY &&
    value.base?.ref === "main" && value.base.sha === BASE_SHA &&
    value.base.repo?.full_name === REPOSITORY;
}

async function main(setStage: SetStage): Promise<void> {
  if (process.env.DEPLOYGUARD_REAL_GITHUB_PR_TEST !== "1") {
    console.log("Skipped: set DEPLOYGUARD_REAL_GITHUB_PR_TEST=1 to opt in. No GitHub or database mutation made.");
    return;
  }
  assert.equal(process.env.DEPLOYGUARD_PR_REPOSITORY_IDENTITY, REPOSITORY);
  assert.equal(process.env.DEPLOYGUARD_PR_DELIVERY_ID, DELIVERY_ID);
  console.log("✓ configuration validated");
  setStage("delivery_lookup");
  const delivery = await getRemediationDelivery(DELIVERY_ID);
  assert(delivery && delivery.status === "PUSHED" && delivery.commitSha === HEAD_SHA);
  assert.equal(delivery.repositoryIdentity, REPOSITORY);
  assert.equal(delivery.sourceBranch, "main");
  assert.equal(delivery.originalHead, BASE_SHA);
  assert.equal(delivery.branchName, HEAD_BRANCH);
  console.log("✓ PUSHED delivery loaded");
  setStage("artifact_lookup");
  const artifact = await getVerifiedArtifactMetadata(delivery.artifactId);
  assert(artifact && artifact.repositoryIdentity === REPOSITORY);
  assert.equal(artifact.sha256, ARTIFACT_SHA);
  assert.equal(createRemediationBranchName(artifact.sha256), HEAD_BRANCH);
  assert.equal(artifact.sourceBranch, "main");
  assert.equal(artifact.sourceCommitSha, BASE_SHA);
  assert.equal(artifact.ingestionSource, "fresh-remote");
  assert.equal(artifact.ingestionRemoteVerified, true);
  console.log("✓ artifact and provenance verified");
  setStage("remote_identity");
  for (const [branch, expected] of [["main", BASE_SHA], [HEAD_BRANCH, HEAD_SHA]]) {
    const response = await readGitHub(`/branches/${encodeURIComponent(branch)}`);
    assert(response.ok);
    const observed = await response.json() as Branch;
    assert.equal(observed.name, branch);
    assert.equal(observed.commit?.sha, expected);
  }
  console.log("✓ remote base and remediation branch verified");
  setStage("github_app_authorization");
  const access = await createInstallationAccessToken("gevalinho", "deployguard-lint-fixture",
    { contents: "read", pull_requests: "write" });
  assert.equal(access.repositoryIdentity, REPOSITORY);
  assert(Date.parse(access.expiresAt) > Date.now());
  console.log("✓ repository-scoped GitHub App authorization acquired");
  setStage("existing_pr_check");
  const list = await readGitHub(`/pulls?${new URLSearchParams({ state: "all",
    head: `gevalinho:${HEAD_BRANCH}`, base: "main", per_page: "100" })}`, access.token);
  assert(list.ok);
  const existing = await list.json() as unknown;
  assert(Array.isArray(existing) && existing.length === 0);
  console.log("✓ no existing open or closed PR found");
  setStage("capability");
  const secret = randomBytes(32).toString("hex");
  const signed = signGitHubPullRequestCapability(
    issueGitHubPullRequestCapability(REPOSITORY, DELIVERY_ID, ARTIFACT_SHA,
      HEAD_BRANCH, HEAD_SHA, "main", BASE_SHA), secret);
  console.log("✓ narrow PR capability issued");
  // A permanent local marker prevents an uncertain POST result from being
  // retried by this harness without explicit human reconciliation.
  setStage("create_pr");
  const marker = join(tmpdir(), `deployguard-first-pr-${DELIVERY_ID}.lock`);
  const handle = await open(marker, "wx", 0o600);
  await handle.close();
  console.log("→ creating pull request");
  const result = await createVerifiedGitHubPullRequest(REPOSITORY, DELIVERY_ID,
    signed, secret, "Verified DeployGuard remediation", "Verified remediation for the lint fixture.");
  assert.equal(result.status, "created");
  assert(result.pullRequest);
  assert(matchesPull(result.pullRequest as Pull, result.pullRequest.number));
  console.log("✓ production PR creation and verification completed");
  setStage("remote_verification");
  const response = await readGitHub(`/pulls/${result.pullRequest.number}`, access.token);
  assert(response.ok);
  const observed = await response.json() as Pull;
  assert(matchesPull(observed, result.pullRequest.number));
  console.log("✓ PR independently retrieved and exact identities verified");
  console.log(`VERIFIED_PR_NUMBER=${result.pullRequest.number}`);
  console.log(`VERIFIED_PR_URL=https://github.com/${REPOSITORY}/pull/${result.pullRequest.number}`);
}

/** Importing this module does not start the real integration. */
export async function runRealGitHubAppPullRequestTest(): Promise<boolean> {
  let stage: Stage = "configuration";
  let passed = false;
  try {
    await main((next) => { stage = next; });
    passed = true;
  } catch {
    // Provider exceptions may contain secrets or transport details.
    console.error(`FAILED_STAGE=${stage}`);
  }
  try { await prisma.$disconnect(); }
  catch { if (passed) console.error("FAILED_STAGE=cleanup"); passed = false; }
  return passed;
}

if (require.main === module) {
  void runRealGitHubAppPullRequestTest().then((passed) => {
    if (!passed) process.exitCode = 1;
  });
}
