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
    | "pull_request_verification_failed";

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
  return fetch(`${GITHUB_API_BASE_URL}${path}`, {
    ...init,

    headers: {
      Accept: "application/vnd.github+json",

      Authorization: `Bearer ${token}`,

      "X-GitHub-Api-Version": GITHUB_API_VERSION,

      ...init.headers,
    },
  });
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

  if (typeof data.commit?.sha !== "string" || !data.commit.sha) {
    return null;
  }

  return data.commit.sha;
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

  if (artifact.repositoryIdentity !== repositoryIdentity) {
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

  if (!baseBranch) {
    return {
      status: "invalid_delivery_state",

      summary:
        "Persisted delivery does not contain verified source-branch provenance.",
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
    );

    if (access.repositoryIdentity !== repositoryIdentity) {
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
   * Only now may DeployGuard cross the external
   * GitHub pull-request mutation boundary.
   */
  const response = await githubRequest(
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(
      repository.repository,
    )}/pulls`,
    token,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        title,
        body,

        head: delivery.branchName,

        base: baseBranch,
      }),
    },
  );

  if (!response.ok) {
    return {
      status: "pull_request_failed",

      summary: `GitHub pull request creation failed with status ${response.status}.`,
    };
  }

  const created = (await response.json()) as GitHubPullRequestResponse;

  /*
   * GitHub returning success is not sufficient.
   * Independently verify the mutation GitHub says
   * it created.
   */
  if (
    typeof created.number !== "number" ||
    typeof created.html_url !== "string" ||
    created.head?.ref !== delivery.branchName ||
    created.head?.sha !== delivery.commitSha ||
    created.base?.ref !== baseBranch ||
    created.base?.sha !== baseHeadSha ||
    created.head?.repo?.full_name !== repositoryIdentity ||
    created.base?.repo?.full_name !== repositoryIdentity
  ) {
    return {
      status: "pull_request_verification_failed",

      summary:
        "GitHub created a pull request whose returned identities do not exactly match the authorized remediation delivery.",
    };
  }

  return {
    status: "created",

    pullRequest: {
      number: created.number,

      url: created.html_url,

      repositoryIdentity,

      deliveryId: delivery.id,

      artifactSha256: artifact.sha256,

      headBranch: delivery.branchName,

      headCommitSha: delivery.commitSha,

      baseBranch,

      baseHeadSha,
    },

    summary:
      "Verified remediation pull request was created through repository-scoped GitHub App authority.",
  };
}
