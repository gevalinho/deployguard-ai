export interface GitHubPullRequestIdentityResponse {
  number?: unknown;
  state?: unknown;
  html_url?: unknown;
  head?: { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } };
  base?: { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } };
}

export interface ExpectedPullRequestIdentity {
  repositoryIdentity: string;
  baseBranch: string;
  baseSha: string;
  headBranch: string;
  headSha: string;
}

export type VerifiedPullRequestIdentity = GitHubPullRequestIdentityResponse & {
  number: number;
  state: "open" | "closed";
  html_url: string;
};

/** Exact provider identity check shared by creation and read-only recovery. */
export function isVerifiedPullRequestIdentity(
  value: GitHubPullRequestIdentityResponse,
  expected: ExpectedPullRequestIdentity,
): value is VerifiedPullRequestIdentity {
  return typeof value.number === "number" && Number.isSafeInteger(value.number) && value.number > 0 &&
    (value.state === "open" || value.state === "closed") &&
    value.html_url === `https://github.com/${expected.repositoryIdentity}/pull/${value.number}` &&
    value.base?.repo?.full_name === expected.repositoryIdentity &&
    value.head?.repo?.full_name === expected.repositoryIdentity &&
    value.base.ref === expected.baseBranch && value.base.sha === expected.baseSha &&
    value.head.ref === expected.headBranch && value.head.sha === expected.headSha;
}
