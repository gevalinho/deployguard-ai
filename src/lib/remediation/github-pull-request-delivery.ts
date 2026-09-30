import { createInstallationAccessToken } from "@/lib/remediation/github-app-auth";

import { getRemediationDelivery } from "@/lib/remediation/remediation-delivery-repository";

import { getVerifiedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";

import { createRemediationBranchName } from "@/lib/remediation/git-delivery";

import {
  type SignedGitHubPullRequestCapability,
  validateGitHubPullRequestCapability,
  verifySignedGitHubPullRequestCapability,
} from "@/lib/remediation/github-pull-request-capability";

const GITHUB_API_BASE_URL = "https://api.github.com";

const GITHUB_API_VERSION = "2022-11-28";

interface GitHubBranchResponse {
  name?: unknown;

  commit?: {
    sha?: unknown;
  };
}

interface GitHubPullRequestResponse {
  number?: unknown;
  html_url?: unknown;

  head?: {
    ref?: unknown;

    sha?: unknown;

    repo?: {
      full_name?: unknown;
    };
  };

  base?: {
    ref?: unknown;

    sha?: unknown;

    repo?: {
      full_name?: unknown;
    };
  };
}

export interface VerifiedGitHubPullRequest {
  number: number;

  url: string;

  repositoryIdentity: string;

  deliveryId: string;

  artifactSha256: string;

  headBranch: string;
  headCommitSha: string;

  baseBranch: string;
  baseHeadSha: string;
}

export interface CreateVerifiedGitHubPullRequestResult {
  status:
    | "created"
    | "delivery_not_found"
    | "invalid_delivery_state"
    | "repository_mismatch"
    | "artifact_not_found"
    | "artifact_mismatch"
    | "invalid_remediation_branch"
    | "invalid_repository_identity"
    | "base_branch_lookup_failed"
    | "head_branch_lookup_failed"
    | "base_head_mismatch"
    | "head_commit_mismatch"
    | "capability_denied"
    | "github_auth_failed"
    | "pull_request_failed"
    | "pull_request_preflight_failed"
    | "pull_request_verification_failed"
    | "already_exists";

  pullRequest?: VerifiedGitHubPullRequest;

  summary: string;
}

function parseRepositoryIdentity(repositoryIdentity: string): {
  owner: string;
  repository: string;
} | null {
  const parts = repositoryIdentity.split("/");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  return {
    owner: parts[0],

    repository: parts[1],
  };
}

async function githubRequest(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),

    headers: {
      Accept: "application/vnd.github+json",

      Authorization: `Bearer ${token}`,

      "X-GitHub-Api-Version": GITHUB_API_VERSION,

      ...init.headers,
    },
    });
  } catch {
    // Never expose authenticated request or transport error details.
    throw new Error("GitHub pull request request failed.");
  }
}

async function getGitHubBranchHead(
  owner: string,
  repository: string,
  branch: string,
  token: string,
): Promise<string | null> {
  const response = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repository,
    )}/branches/${encodeURIComponent(branch)}`,
    token,
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as GitHubBranchResponse;

  if (data.name !== branch || typeof data.commit?.sha !== "string" || !data.commit.sha) {
    return null;
  }

  return data.commit.sha;
}

function matchesAuthorizedPullRequest(
  value: GitHubPullRequestResponse,
  repositoryIdentity: string,
  delivery: { branchName: string; commitSha: string | null; sourceBranch: string },
  baseHeadSha: string,
): value is GitHubPullRequestResponse & { number: number; html_url: string } {
  return typeof value.number === "number" && Number.isSafeInteger(value.number) && value.number > 0 &&
    value.html_url === `https://github.com/${repositoryIdentity}/pull/${value.number}` &&
    value.head?.ref === delivery.branchName && value.head.sha === delivery.commitSha &&
    value.base?.ref === delivery.sourceBranch && value.base.sha === baseHeadSha &&
    value.head.repo?.full_name === repositoryIdentity &&
    value.base.repo?.full_name === repositoryIdentity;
}

export async function createVerifiedGitHubPullRequest(
  repositoryIdentity: string,
  deliveryId: string,
  signedCapability: SignedGitHubPullRequestCapability,
  capabilitySigningSecret: string,
  title: string,
  body: string,
): Promise<CreateVerifiedGitHubPullRequestResult> {
  /*
   * Durable delivery evidence is reconstructed
   * independently from caller-supplied authority.
   */
  const delivery = await getRemediationDelivery(deliveryId);

  if (!delivery) {
    return {
      status: "delivery_not_found",

      summary: "Persisted remediation delivery was not found.",
    };
  }

  /*
   * PR creation is downstream of the verified
   * remote push boundary.
   */
  if (delivery.status !== "PUSHED" || !delivery.commitSha) {
    return {
      status: "invalid_delivery_state",

      summary: "Only a PUSHED remediation delivery may create a pull request.",
    };
  }

  if (delivery.repositoryIdentity !== repositoryIdentity) {
    return {
      status: "repository_mismatch",

      summary: "Persisted remediation delivery belongs to another repository.",
    };
  }

  const repository = parseRepositoryIdentity(repositoryIdentity);

  if (!repository) {
    return {
      status: "invalid_repository_identity",

      summary: "Repository identity must be owner/repository.",
    };
  }

  /*
   * Recover immutable artifact metadata.
   */
  const artifact = await getVerifiedArtifactMetadata(delivery.artifactId);

  if (!artifact) {
    return {
      status: "artifact_not_found",

      summary: "Verified remediation artifact metadata could not be recovered.",
    };
  }

  if (artifact.repositoryIdentity !== repositoryIdentity ||
      artifact.sourceBranch !== delivery.sourceBranch ||
      artifact.sourceCommitSha !== delivery.originalHead ||
      artifact.ingestionSource !== "fresh-remote" ||
      artifact.ingestionRemoteVerified !== true) {
    return {
      status: "artifact_mismatch",

      summary: "Verified remediation artifact belongs to another repository.",
    };
  }

  /*
   * Reconstruct DeployGuard's deterministic branch
   * instead of trusting the persisted branch name.
   */
  const expectedHeadBranch = createRemediationBranchName(artifact.sha256);

  if (delivery.branchName !== expectedHeadBranch) {
    return {
      status: "invalid_remediation_branch",

      summary:
        "Persisted remediation branch does not match the verified artifact identity.",
    };
  }

  /*
   * The base branch comes from verified repository
   * provenance persisted during PREPARED.
   */
  const baseBranch = delivery.sourceBranch;

  if (baseBranch !== "main") {
    return {
      status: "invalid_delivery_state",

      summary:
        "Pull request base must be the verified main source branch.",
    };
  }

  /*
   * Cryptographic authority must itself be valid
   * before GitHub credentials are acquired.
   */
  if (
    !verifySignedGitHubPullRequestCapability(
      signedCapability,
      capabilitySigningSecret,
    )
  ) {
    return {
      status: "capability_denied",

      summary: "GitHub pull request capability signature is invalid.",
    };
  }

  let token: string;

  try {
    const access = await createInstallationAccessToken(
      repository.owner,
      repository.repository,
      { contents: "read", pull_requests: "write" },
    );

    if (access.repositoryIdentity !== repositoryIdentity ||
        !Number.isFinite(Date.parse(access.expiresAt)) ||
        Date.parse(access.expiresAt) <= Date.now()) {
      return {
        status: "github_auth_failed",

        summary:
          "GitHub App installation authority resolved to another repository.",
      };
    }

    token = access.token;
  } catch {
    return {
      status: "github_auth_failed",

      summary: "GitHub App repository authority could not be acquired.",
    };
  }

  /*
   * Independently observe both sides of the PR
   * directly from GitHub.
   */
  const baseHeadSha = await getGitHubBranchHead(
    repository.owner,
    repository.repository,
    baseBranch,
    token,
  );

  if (!baseHeadSha) {
    return {
      status: "base_branch_lookup_failed",

      summary: "GitHub base branch HEAD could not be independently observed.",
    };
  }

  if (baseHeadSha !== delivery.originalHead) {
    return { status: "base_head_mismatch",
      summary: "GitHub main moved from the authorized original HEAD." };
  }

  const headCommitSha = await getGitHubBranchHead(
    repository.owner,
    repository.repository,
    delivery.branchName,
    token,
  );

  if (!headCommitSha) {
    return {
      status: "head_branch_lookup_failed",

      summary:
        "GitHub remediation branch HEAD could not be independently observed.",
    };
  }

  /*
   * The remote remediation branch must still point
   * to the exact immutable commit recorded by the
   * verified PUSHED delivery.
   */
  if (headCommitSha !== delivery.commitSha) {
    return {
      status: "head_commit_mismatch",

      summary:
        "GitHub remediation branch no longer resolves to the persisted remediation commit.",
    };
  }

  /*
   * Validate the signed authority against values
   * reconstructed from persistence and GitHub.
   *
   * Nothing security-sensitive here comes from
   * arbitrary caller input.
   */
  if (
    !validateGitHubPullRequestCapability(
      signedCapability.capability,
      repositoryIdentity,
      delivery.id,
      artifact.sha256,
      delivery.branchName,
      delivery.commitSha,
      baseBranch,
      baseHeadSha,
    )
  ) {
    /*
     * Distinguish base movement because this is an
     * important stale-authority condition.
     */
    if (signedCapability.capability.baseHeadSha !== baseHeadSha) {
      return {
        status: "base_head_mismatch",

        summary:
          "GitHub base branch HEAD changed after pull request authority was issued.",
      };
    }

    return {
      status: "capability_denied",

      summary:
        "Signed pull request capability does not authorize the independently reconstructed delivery state.",
    };
  }

  /*
   * A previous POST may have succeeded while its response or verification
   * failed. Search open and closed PRs before another mutation. A full page
   * is ambiguous, so fail closed instead of risking a duplicate.
   */
  const list = await githubRequest(
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/pulls?` +
      new URLSearchParams({ state: "all", head: `${repository.owner}:${delivery.branchName}`,
        base: baseBranch, per_page: "100" }).toString(),
    token,
  );
  if (!list.ok) return { status: "pull_request_preflight_failed",
    summary: "Existing pull requests could not be checked." };
  let listed: GitHubPullRequestResponse[];
  try { listed = await list.json() as GitHubPullRequestResponse[]; }
  catch { return { status: "pull_request_preflight_failed", summary: "Existing pull requests could not be checked." }; }
  if (!Array.isArray(listed) || listed.length >= 100) return {
    status: "pull_request_preflight_failed", summary: "Existing pull request listing is ambiguous." };
  let number: number;
  let status: "created" | "already_exists";
  if (listed.length > 0) {
    if (listed.length !== 1 || !matchesAuthorizedPullRequest(listed[0], repositoryIdentity, delivery, baseHeadSha)) {
      return { status: "pull_request_verification_failed",
        summary: "Existing pull request identity is ambiguous." };
    }
    number = listed[0].number;
    status = "already_exists";
  } else {
    // Authorization may expire or the branches may move during the read-only
    // retry check. Refresh both observations immediately before POST.
    const currentBase = await getGitHubBranchHead(repository.owner, repository.repository, baseBranch, token);
    const currentHead = await getGitHubBranchHead(repository.owner, repository.repository, delivery.branchName, token);
    if (currentBase !== delivery.originalHead || currentHead !== delivery.commitSha ||
        !verifySignedGitHubPullRequestCapability(signedCapability, capabilitySigningSecret) ||
        !validateGitHubPullRequestCapability(signedCapability.capability,
          repositoryIdentity, delivery.id, artifact.sha256, delivery.branchName,
          delivery.commitSha, baseBranch, currentBase)) {
      return { status: "capability_denied",
        summary: "Pull request authority or remote branch identity changed before creation." };
    }
    const response = await githubRequest(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/pulls`,
      token,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, head: delivery.branchName, base: baseBranch }) },
    );
    if (!response.ok) return { status: "pull_request_failed",
      summary: `GitHub pull request creation failed with status ${response.status}.` };
    let created: GitHubPullRequestResponse;
    try { created = await response.json() as GitHubPullRequestResponse; }
    catch { return { status: "pull_request_verification_failed",
      summary: "GitHub pull request creation response could not be verified." }; }
    if (!matchesAuthorizedPullRequest(created, repositoryIdentity, delivery, baseHeadSha)) {
      return { status: "pull_request_verification_failed",
        summary: "GitHub pull request creation response did not match authorized identities." };
    }
    number = created.number;
    status = "created";
  }

  // Independent GET is required even when POST or listing returned matching
  // data. Returning success never relies solely on a mutation response.
  const observed = await githubRequest(
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}/pulls/${number}`,
    token,
  );
  if (!observed.ok) return { status: "pull_request_verification_failed",
    summary: "GitHub pull request could not be independently retrieved." };
  let verified: GitHubPullRequestResponse;
  try { verified = await observed.json() as GitHubPullRequestResponse; }
  catch { return { status: "pull_request_verification_failed",
    summary: "GitHub pull request could not be independently verified." }; }
  if (!matchesAuthorizedPullRequest(verified, repositoryIdentity, delivery, baseHeadSha) ||
      verified.number !== number) {
    return { status: "pull_request_verification_failed",
      summary: "GitHub pull request identities do not match the authorized delivery." };
  }
  return {
    status,
    pullRequest: {
      number,
      url: verified.html_url,
      repositoryIdentity,
      deliveryId: delivery.id,
      artifactSha256: artifact.sha256,
      headBranch: delivery.branchName,
      headCommitSha: delivery.commitSha,
      baseBranch,
      baseHeadSha,
    },
    summary: status === "created" ?
      "Verified remediation pull request was created and independently retrieved." :
      "Existing verified remediation pull request was independently retrieved.",
  };
}
