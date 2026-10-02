import { createInstallationAccessToken } from "@/lib/remediation/github-app-auth";
import { githubRemoteMatches } from "@/lib/remediation/github-app-git-transport";
import { updateVerifiedPullRequestState, type DurablePullRequestDelivery } from "@/lib/remediation/github-pull-request-repository";
import type { RemediationDeliveryMetadata } from "@/lib/remediation/remediation-delivery-repository";
import type { GitHubPullRequestIdentityResponse } from "@/lib/remediation/github-pull-request-identity";

interface StatusDependencies {
  token: typeof createInstallationAccessToken;
  request: typeof fetch;
  persist: typeof updateVerifiedPullRequestState;
}

/** Refresh only a previously verified PR. Caller must authenticate, authorize,
 * and validate the persisted artifact/delivery relationship first.
 * Never grants creation authority or reconciles uncertain POST attempts. */
export async function refreshVerifiedGitHubPullRequest(
  delivery: RemediationDeliveryMetadata, recorded: DurablePullRequestDelivery,
  deps: StatusDependencies = { token: createInstallationAccessToken, request: fetch, persist: updateVerifiedPullRequestState },
): Promise<DurablePullRequestDelivery | null> {
  try {
    const identity = delivery.repositoryIdentity;
    if (delivery.status !== "PUSHED" || !delivery.commitSha || delivery.sourceBranch !== "main" ||
        !githubRemoteMatches(identity, `https://github.com/${identity}.git`) ||
        recorded.status !== "VERIFIED" || !recorded.verifiedAt || recorded.provider !== "github" ||
        recorded.deliveryId !== delivery.id || recorded.repositoryIdentity !== identity ||
        !Number.isSafeInteger(recorded.prNumber) || recorded.prNumber! <= 0 ||
        recorded.prUrl !== `https://github.com/${identity}/pull/${recorded.prNumber}`) return null;
    const [owner, repository] = identity.split("/");
    const access = await deps.token(owner, repository, { pull_requests: "read" });
    if (access.repositoryIdentity !== identity || !access.token ||
        !Number.isFinite(Date.parse(access.expiresAt)) || Date.parse(access.expiresAt) <= Date.now()) return null;
    const response = await deps.request(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${recorded.prNumber}`, {
        method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${access.token}`,
          "X-GitHub-Api-Version": "2022-11-28" },
      });
    if (!response.ok) return null;
    const value = await response.json() as (GitHubPullRequestIdentityResponse & { merged?: unknown }) | null;
    // A merged PR advances the base and may have its branch deleted. Inspect the
    // recorded PR's identity, not current branch refs or the creation-time base SHA.
    // The exact remediation commit is still required. This check cannot authorize
    // a new PR, push, or change to the immutable verified identity.
    if (!value || value.number !== recorded.prNumber || value.html_url !== recorded.prUrl ||
        value.base?.repo?.full_name !== identity || value.head?.repo?.full_name !== identity ||
        value.base.ref !== delivery.sourceBranch || value.head.ref !== delivery.branchName ||
        value.head.sha !== delivery.commitSha || typeof value.merged !== "boolean" ||
        !["open", "closed"].includes(String(value.state)) || (value.merged && value.state !== "closed")) return null;
    const state = value.merged ? "merged" : value.state as "open" | "closed";
    // A verified merge is terminal; inconsistent later reads must not regress it.
    if (recorded.prState === "merged" && state !== "merged") return null;
    return await deps.persist(recorded, state);
  } catch { return null; }
}
