import { createInstallationAccessToken } from "@/lib/remediation/github-app-auth";
import { matchesVerifiedArtifactProvenance } from "@/lib/remediation/artifact-delivery-reference";
import { createRemediationBranchName } from "@/lib/remediation/git-delivery";
import { isVerifiedPullRequestIdentity, type GitHubPullRequestIdentityResponse,
  type VerifiedPullRequestIdentity } from "@/lib/remediation/github-pull-request-identity";
import { claimPullRequestDelivery, getDurablePullRequestDelivery,
  persistVerifiedPullRequest } from "@/lib/remediation/github-pull-request-repository";
import { getRemediationDelivery } from "@/lib/remediation/remediation-delivery-repository";
import { getVerifiedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";

export type PullRequestRecoveryResult =
  | { status: "recovered" | "already_verified"; number: number; url: string; state: "open" | "closed" }
  | { status: "delivery_denied" | "artifact_denied" | "repository_denied" |
      "auth_failed" | "branch_mismatch" | "none" | "ambiguous" | "github_read_failed" |
      "durable_conflict" | "persistence_failed" };

type Branch = { name?: unknown; commit?: { sha?: unknown } };

/** GET-only GitHub reconciliation. This module has no PR mutation request. */
export async function recoverExistingGitHubPullRequest(
  deliveryId: string, expectedNumber?: number,
): Promise<PullRequestRecoveryResult> {
  let delivery: Awaited<ReturnType<typeof getRemediationDelivery>>;
  try { delivery = await getRemediationDelivery(deliveryId); }
  catch { return { status: "persistence_failed" }; }
  if (!delivery || delivery.status !== "PUSHED" || !delivery.commitSha ||
      delivery.sourceBranch !== "main") return { status: "delivery_denied" };
  const parts = delivery.repositoryIdentity.split("/");
  if (parts.length !== 2 || !/^[A-Za-z0-9-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9_.-]+$/.test(parts[1]) || parts[1] === "." || parts[1] === "..") {
    return { status: "repository_denied" };
  }
  const [owner, repository] = parts;
  let artifact: Awaited<ReturnType<typeof getVerifiedArtifactMetadata>>;
  try { artifact = await getVerifiedArtifactMetadata(delivery.artifactId); }
  catch { return { status: "persistence_failed" }; }
  if (!artifact || artifact.repositoryIdentity !== delivery.repositoryIdentity ||
      delivery.branchName !== createRemediationBranchName(artifact.sha256) ||
      !matchesVerifiedArtifactProvenance(artifact, { source: "fresh-remote", remoteVerified: true,
        sourceBranch: delivery.sourceBranch, commitSha: delivery.originalHead })) {
    return { status: "artifact_denied" };
  }
  let durable: Awaited<ReturnType<typeof getDurablePullRequestDelivery>>;
  try { durable = await getDurablePullRequestDelivery(delivery.id); }
  catch { return { status: "persistence_failed" }; }
  if (durable && (durable.provider !== "github" || durable.repositoryIdentity !== delivery.repositoryIdentity ||
      (durable.status === "VERIFIED" && (!durable.prNumber || !durable.prUrl || !durable.prState || !durable.verifiedAt)) ||
      (durable.status !== "VERIFIED" && (durable.prNumber !== null || durable.prUrl !== null || durable.prState !== null)))) {
    return { status: "durable_conflict" };
  }
  let token: string;
  try {
    const access = await createInstallationAccessToken(owner, repository,
      { contents: "read", pull_requests: "read" });
    if (access.repositoryIdentity !== delivery.repositoryIdentity ||
        !Number.isFinite(Date.parse(access.expiresAt)) || Date.parse(access.expiresAt) <= Date.now()) {
      return { status: "auth_failed" };
    }
    token = access.token;
  } catch { return { status: "auth_failed" }; }
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  const read = async (path: string): Promise<unknown> => {
    const response = await fetch(`${api}${path}`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok) throw new Error("GitHub read failed");
    return response.json();
  };
  let verified: VerifiedPullRequestIdentity;
  try {
    for (const [branch, sha] of [[delivery.sourceBranch, delivery.originalHead],
      [delivery.branchName, delivery.commitSha]] as const) {
      const observed = await read(`/branches/${encodeURIComponent(branch)}`) as Branch;
      if (observed.name !== branch || observed.commit?.sha !== sha) return { status: "branch_mismatch" };
    }
    const query = new URLSearchParams({ state: "all", head: `${owner}:${delivery.branchName}`,
      base: delivery.sourceBranch, per_page: "2" });
    const listed = await read(`/pulls?${query}`) as unknown;
    if (!Array.isArray(listed)) return { status: "ambiguous" };
    if (listed.length === 0) return { status: "none" };
    if (listed.length !== 1) return { status: "ambiguous" };
    const listedNumber = (listed[0] as GitHubPullRequestIdentityResponse)?.number;
    if (typeof listedNumber !== "number" || !Number.isSafeInteger(listedNumber) || listedNumber <= 0) {
      return { status: "ambiguous" };
    }
    const observed = await read(`/pulls/${listedNumber}`) as GitHubPullRequestIdentityResponse;
    if (!isVerifiedPullRequestIdentity(observed, { repositoryIdentity: delivery.repositoryIdentity,
      baseBranch: delivery.sourceBranch, baseSha: delivery.originalHead,
      headBranch: delivery.branchName, headSha: delivery.commitSha }) ||
      observed.number !== listedNumber) return { status: "ambiguous" };
    verified = observed;
    if (expectedNumber !== undefined && verified.number !== expectedNumber) return { status: "durable_conflict" };
  } catch { return { status: "github_read_failed" }; }
  try {
    if (durable?.status === "VERIFIED") {
      if (durable.prNumber !== verified.number || durable.prUrl !== verified.html_url ||
          durable.prState !== verified.state) return { status: "durable_conflict" };
      return { status: "already_verified", number: verified.number,
        url: verified.html_url, state: verified.state };
    }
    if (!durable) {
      const claimed = await claimPullRequestDelivery(delivery.id, delivery.repositoryIdentity);
      if (!claimed) {
        durable = await getDurablePullRequestDelivery(delivery.id);
        if (!durable || durable.provider !== "github" ||
            durable.repositoryIdentity !== delivery.repositoryIdentity) return { status: "durable_conflict" };
        if (durable.status === "VERIFIED") {
          return durable.prNumber === verified.number && durable.prUrl === verified.html_url &&
            durable.prState === verified.state ?
            { status: "already_verified", number: verified.number, url: verified.html_url, state: verified.state } :
            { status: "durable_conflict" };
        }
      }
    }
    const persisted = await persistVerifiedPullRequest(delivery.id, delivery.repositoryIdentity,
      verified.number, verified.html_url, verified.state, true);
    if (!persisted) return { status: "durable_conflict" };
    return { status: "recovered", number: verified.number, url: verified.html_url, state: verified.state };
  } catch { return { status: "persistence_failed" }; }
}
