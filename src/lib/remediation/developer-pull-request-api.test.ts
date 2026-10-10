import { describe, expect, it, vi } from "vitest";
import {
  handleDeveloperPullRequestPost,
  type PullRequestApiDependencies,
} from "./developer-pull-request-api";
import { deliveryApiDependencies } from "./developer-delivery-api";
import type { TrustedArtifactMetadata } from "./trusted-artifact-repository";
import type { RemediationDeliveryMetadata } from "./remediation-delivery-repository";

const artifact: TrustedArtifactMetadata = {
  id: "artifact123",
  repositoryIdentity: "owner/repo",
  format: "unified_diff",
  sha256: "b".repeat(64),
  byteSize: 12,
  createdAt: new Date(),
  sourceCommitSha: "a".repeat(40),
  sourceBranch: "main",
  ingestionSource: "verified-cache",
  ingestionRemoteVerified: true,
};

const delivery: RemediationDeliveryMetadata = {
  id: "delivery123",
  artifactId: artifact.id,
  repositoryIdentity: artifact.repositoryIdentity,
  originalHead: artifact.sourceCommitSha!,
  sourceBranch: artifact.sourceBranch!,
  branchName: `deployguard/remediation-${artifact.sha256.slice(0, 12)}`,
  preparedDiffSha256: "c".repeat(64),
  status: "PUSHED",
  commitSha: "d".repeat(40),
  remoteName: "origin",
  createdAt: new Date(),
  updatedAt: new Date(),
  committedAt: new Date(),
  pushedAt: new Date(),
};

function request(
  body: unknown = { confirmPullRequest: true },
  origin = "https://deployguard.test",
): Request {
  return new Request(
    `https://deployguard.test/api/remediation/delivery/${delivery.id}/pull-request`,
    {
      method: "POST",
      headers: {
        origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function setup() {
  const create = vi.fn();
  const authorize = vi.fn(async () => true);

  const deps: PullRequestApiDependencies = {
    ...deliveryApiDependencies,
    session: () => ({
      githubId: "1",
      login: "developer",
      expiresAt: Date.now() + 60_000,
    }),
    delivery: async () => delivery,
    artifact: async () => artifact,
    authorize,
    pr: async () => null,
    create,
  };

  return { deps, create, authorize };
}

describe("developer pull request authorization boundary", () => {
  it("rejects unauthenticated requests without creating a PR", async () => {
    const { deps, create } = setup();

    const response = await handleDeveloperPullRequestPost(
      request(),
      delivery.id,
      { ...deps, session: () => null },
    );

    expect(response.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => {
    const { deps, create } = setup();

    const response = await handleDeveloperPullRequestPost(
      request({ confirmPullRequest: true }, "https://attacker.test"),
      delivery.id,
      deps,
    );

    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { confirmPullRequest: false },
    { confirmPullRequest: "true" },
    { confirmPullRequest: true, extra: "unexpected" },
  ])("rejects requests without exact confirmation: %j", async (body) => {
    const { deps, create } = setup();

    const response = await handleDeveloperPullRequestPost(
      request(body),
      delivery.id,
      deps,
    );

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects unauthorized repository access", async () => {
    const { deps, create, authorize } = setup();
    authorize.mockResolvedValue(false);

    const response = await handleDeveloperPullRequestPost(
      request(),
      delivery.id,
      deps,
    );

    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects deliveries that have not been pushed", async () => {
    const { deps, create } = setup();

    const response = await handleDeveloperPullRequestPost(
      request(),
      delivery.id,
      {
        ...deps,
        delivery: async () => ({
          ...delivery,
          status: "COMMITTED",
          pushedAt: null,
          remoteName: null,
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects mismatched trusted artifact identity", async () => {
    const { deps, create } = setup();

    const response = await handleDeveloperPullRequestPost(
      request(),
      delivery.id,
      {
        ...deps,
        artifact: async () => ({
          ...artifact,
          sha256: "e".repeat(64),
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it("does not claim success when PR creation fails", async () => {
    const { deps, create } = setup();

    create.mockResolvedValue({
      status: "pull_request_preflight_failed",
      summary: "GitHub preflight failed.",
    });

    const response = await handleDeveloperPullRequestPost(
      request(),
      delivery.id,
      deps,
    );

    expect(response.status).toBe(503);
    expect(create).toHaveBeenCalledOnce();

    const result = await response.json();
    expect(result.ok).toBe(false);
    expect(result.code).toBe("pull_request_preflight_failed");
  });

  it("does not expose an unpersisted successful PR response", async () => {
    const { deps, create } = setup();

    create.mockResolvedValue({
      status: "created",
      summary: "PR created.",
    });

    const response = await handleDeveloperPullRequestPost(
      request(),
      delivery.id,
      deps,
    );

    expect(response.status).toBe(503);
    expect(create).toHaveBeenCalledOnce();

    const result = await response.json();
    expect(result.ok).toBe(false);
    expect(result.code).toBe("persistence_failed");
  });
});
