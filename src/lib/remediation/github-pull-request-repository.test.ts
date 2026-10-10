import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/database/prisma", () => ({
  prisma: {
    gitHubPullRequestDelivery: mocks,
  },
}));

import {
  claimPullRequestDelivery,
  markPullRequestPostAttempted,
  persistVerifiedPullRequest,
} from "./github-pull-request-repository";

const deliveryId = "delivery123";
const repositoryIdentity = "owner/repo";
const prUrl = "https://github.com/owner/repo/pull/42";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("durable GitHub PR claim", () => {
  it("allows the first delivery claim", async () => {
    mocks.create.mockResolvedValue({ deliveryId });

    const claimed = await claimPullRequestDelivery(
      deliveryId,
      repositoryIdentity,
    );

    expect(claimed).toBe(true);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        deliveryId,
        repositoryIdentity,
        provider: "github",
        status: "CLAIMED",
      },
    });
  });

  it("does not grant a second claim for an existing delivery", async () => {
    mocks.create.mockRejectedValue(new Error("Unique constraint"));
    mocks.findUnique.mockResolvedValue({
      deliveryId,
      repositoryIdentity,
      provider: "github",
      status: "CLAIMED",
    });

    const claimed = await claimPullRequestDelivery(
      deliveryId,
      repositoryIdentity,
    );

    expect(claimed).toBe(false);
  });

  it("does not hide unexpected database failures", async () => {
    mocks.create.mockRejectedValue(new Error("Database unavailable"));
    mocks.findUnique.mockResolvedValue(null);

    await expect(
      claimPullRequestDelivery(deliveryId, repositoryIdentity),
    ).rejects.toThrow("Database unavailable");
  });
});

describe("GitHub PR POST attempt boundary", () => {
  it("permits the transition from CLAIMED to POST_ATTEMPTED", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const attempted = await markPullRequestPostAttempted(deliveryId);

    expect(attempted).toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { deliveryId, status: "CLAIMED" },
      data: {
        status: "POST_ATTEMPTED",
        attemptedAt: expect.any(Date),
      },
    });
  });

  it("rejects a repeated POST attempt transition", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const attempted = await markPullRequestPostAttempted(deliveryId);

    expect(attempted).toBe(false);
  });
});

describe("verified GitHub PR persistence", () => {
  it("rejects persistence without a durable claim", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const persisted = await persistVerifiedPullRequest(
      deliveryId, repositoryIdentity, 42, prUrl, "open", false,
    );

    expect(persisted).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects persistence for another repository", async () => {
    mocks.findUnique.mockResolvedValue({
      deliveryId,
      repositoryIdentity: "other/repo",
      provider: "github",
      status: "POST_ATTEMPTED",
    });

    const persisted = await persistVerifiedPullRequest(
      deliveryId, repositoryIdentity, 42, prUrl, "open", false,
    );

    expect(persisted).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("persists a verified PR after a POST attempt", async () => {
    mocks.findUnique.mockResolvedValue({
      deliveryId,
      repositoryIdentity,
      provider: "github",
      status: "POST_ATTEMPTED",
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const persisted = await persistVerifiedPullRequest(
      deliveryId, repositoryIdentity, 42, prUrl, "open", false,
    );

    expect(persisted).toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deliveryId,
          status: { in: ["CLAIMED", "POST_ATTEMPTED"] },
          prNumber: null,
        }),
        data: expect.objectContaining({
          status: "VERIFIED",
          prNumber: 42,
          prUrl,
        }),
      }),
    );
  });

  it("rejects conflicting previously verified PR identity", async () => {
    mocks.findUnique.mockResolvedValue({
      deliveryId,
      repositoryIdentity,
      provider: "github",
      status: "VERIFIED",
      prNumber: 99,
      prUrl: "https://github.com/owner/repo/pull/99",
    });

    const persisted = await persistVerifiedPullRequest(
      deliveryId, repositoryIdentity, 42, prUrl, "open", true,
    );

    expect(persisted).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
