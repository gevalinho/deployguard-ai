import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDelivery: vi.fn(),
  getArtifact: vi.fn(),
  getDurable: vi.fn(),
  claim: vi.fn(),
  markAttempted: vi.fn(),
  persist: vi.fn(),
  token: vi.fn(),
}));

vi.mock("./remediation-delivery-repository", () => ({
  getRemediationDelivery: mocks.getDelivery,
}));

vi.mock("./trusted-artifact-repository", () => ({
  getVerifiedArtifactMetadata: mocks.getArtifact,
}));

vi.mock("./github-pull-request-repository", () => ({
  getDurablePullRequestDelivery: mocks.getDurable,
  claimPullRequestDelivery: mocks.claim,
  markPullRequestPostAttempted: mocks.markAttempted,
  persistVerifiedPullRequest: mocks.persist,
}));

vi.mock("./github-app-auth", () => ({
  createInstallationAccessToken: mocks.token,
}));

import {
  issueGitHubPullRequestCapability,
  signGitHubPullRequestCapability,
} from "./github-pull-request-capability";

import {
  createVerifiedGitHubPullRequest,
} from "./github-pull-request-delivery";

const repo = "owner/repo";
const deliveryId = "delivery123";
const artifactSha = "b".repeat(64);
const baseSha = "a".repeat(40);
const headSha = "d".repeat(40);
const headBranch = `deployguard/remediation-${artifactSha.slice(0, 12)}`;
const secret = "test-only-signing-secret";

const delivery = {
  id: deliveryId,
  artifactId: "artifact123",
  status: "PUSHED",
  repositoryIdentity: repo,
  originalHead: baseSha,
  sourceBranch: "main",
  branchName: headBranch,
  preparedDiffSha256: "c".repeat(64),
  commitSha: headSha,
  remoteName: "origin",
  createdAt: new Date(),
  updatedAt: new Date(),
  committedAt: new Date(),
  pushedAt: new Date(),
};

const artifact = {
  id: "artifact123",
  repositoryIdentity: repo,
  format: "unified-diff",
  sha256: artifactSha,
  byteSize: 100,
  createdAt: new Date(),
  sourceCommitSha: baseSha,
  sourceBranch: "main",
  ingestionSource: "fresh-remote",
  ingestionRemoteVerified: true,
};

function signedCapability() {
  return signGitHubPullRequestCapability(
    issueGitHubPullRequestCapability(
      repo, deliveryId, artifactSha,
      headBranch, headSha, "main", baseSha,
    ),
    secret,
  );
}

function pr() {
  return {
    number: 42,
    state: "open",
    html_url: "https://github.com/owner/repo/pull/42",
    head: {
      ref: headBranch,
      sha: headSha,
      repo: { full_name: repo },
    },
    base: {
      ref: "main",
      sha: baseSha,
      repo: { full_name: repo },
    },
  };
}

function response(value: unknown, ok = true) {
  return {
    ok,
    json: async () => value,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();

  mocks.getDelivery.mockResolvedValue(delivery);
  mocks.getArtifact.mockResolvedValue(artifact);
  mocks.getDurable.mockResolvedValue(null);
  mocks.claim.mockResolvedValue(true);
  mocks.markAttempted.mockResolvedValue(true);
  mocks.persist.mockResolvedValue(true);

  mocks.token.mockResolvedValue({
    token: "fake-token",
    repositoryIdentity: repo,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    installationId: 1,
  });

  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockBranchesAndPRs(options: {
  beforePost?: unknown[];
  post?: "success" | "lost" | "failed";
  afterPost?: unknown[] | null;
}) {
  let listCount = 0;

  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("/branches/")) {
      const isBase = url.endsWith("/branches/main");
      return response({
        name: isBase ? "main" : headBranch,
        commit: { sha: isBase ? baseSha : headSha },
      });
    }

    if (url.includes("/pulls?")) {
      listCount++;
      const listed = listCount === 1
        ? (options.beforePost ?? [])
        : (options.afterPost ?? []);
      if (listed === null) return response({}, false);
      return response(listed);
    }

    if (url.endsWith("/pulls/42")) {
      return response(pr());
    }

    if (url.endsWith("/pulls") && init?.method === "POST") {
      if (options.post === "lost") {
        throw new Error("Simulated lost GitHub response");
      }
      if (options.post === "failed") {
        return response({}, false);
      }
      return response(pr());
    }

    throw new Error(`Unexpected GitHub request: ${url}`);
  });
}

async function execute() {
  return createVerifiedGitHubPullRequest(
    repo, deliveryId, signedCapability(),
    secret, "Verified remediation", "Automated remediation details",
  );
}

function postCount() {
  return fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  ).length;
}

describe("GitHub PR creation and recovery", () => {
  it("creates and verifies a PR after a successful POST", async () => {
    mockBranchesAndPRs({ post: "success" });

    const result = await execute();

    expect(result.status).toBe("created");
    expect(result.pullRequest?.number).toBe(42);
    expect(postCount()).toBe(1);
    expect(mocks.markAttempted).toHaveBeenCalledOnce();
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it("recovers an existing PR after a lost POST response", async () => {
    mockBranchesAndPRs({
      post: "lost",
      afterPost: [pr()],
    });

    const result = await execute();

    expect(result.status).toBe("already_exists");
    expect(result.pullRequest?.number).toBe(42);
    expect(postCount()).toBe(1);
    expect(mocks.persist).toHaveBeenCalledWith(
      deliveryId, repo, 42,
      "https://github.com/owner/repo/pull/42",
      "open", true,
    );
  });

  it("requires recovery when a lost POST cannot be reconciled", async () => {
    mockBranchesAndPRs({
      post: "lost",
      afterPost: [],
    });

    const result = await execute();

    expect(result.status).toBe("recovery_required");
    expect(postCount()).toBe(1);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("does not POST again after a previous POST_ATTEMPTED claim", async () => {
    mocks.getDurable.mockResolvedValue({
      deliveryId,
      repositoryIdentity: repo,
      provider: "github",
      status: "POST_ATTEMPTED",
      prNumber: null,
      prUrl: null,
    });

    mockBranchesAndPRs({ beforePost: [] });

    const result = await execute();

    expect(result.status).toBe("recovery_required");
    expect(postCount()).toBe(0);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.markAttempted).not.toHaveBeenCalled();
  });

  it("rejects ambiguous remote PR identity without POST", async () => {
    mockBranchesAndPRs({
      beforePost: [
        pr(),
        { ...pr(), number: 43 },
      ],
    });

    const result = await execute();

    expect(result.status).toBe("pull_request_verification_failed");
    expect(postCount()).toBe(0);
  });

  it("does not POST if the durable attempt transition fails", async () => {
    mocks.markAttempted.mockResolvedValue(false);
    mockBranchesAndPRs({ beforePost: [] });

    const result = await execute();

    expect(result.status).toBe("persistence_failed");
    expect(postCount()).toBe(0);
  });

  it("recovers an existing PR before attempting creation", async () => {
    mockBranchesAndPRs({ beforePost: [pr()] });

    const result = await execute();

    expect(result.status).toBe("already_exists");
    expect(postCount()).toBe(0);
    expect(mocks.persist).toHaveBeenCalledOnce();
  });
});
