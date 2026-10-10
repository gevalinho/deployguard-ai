import {
  claimPullRequestDelivery,
  getDurablePullRequestDelivery,
  markPullRequestPostAttempted,
  persistVerifiedPullRequest,
} from "../../src/lib/remediation/github-pull-request-repository";

import { prisma } from "../../src/lib/database/prisma";

// const EXPECTED_DATABASE =
//   "postgresql://deployguard_test:deployguard_local_test_only@127.0.0.1:55432/deployguard_test?schema=public";

const testDatabaseUrl = process.env.DATABASE_URL;

async function main() {
  if (process.env.DEPLOYGUARD_INTEGRATION_TEST !== "true") {
    throw new Error("Integration test must be explicitly enabled.");
  }

  if (!testDatabaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const parsed = new URL(testDatabaseUrl);

  if (
    parsed.protocol !== "postgresql:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.port !== "55432" ||
    parsed.pathname !== "/deployguard_test" ||
    parsed.username !== "deployguard_test"
  ) {
    throw new Error("Refusing to use a non-isolated test database.");
  }

  // Keep the rest of the existing main() implementation here.

  const suffix = `pr-wrapper-${Date.now()}-${process.pid}`;
  const artifactId = `${suffix}-artifact`;
  const deliveryId = `${suffix}-delivery`;
  const repositoryIdentity = "test/deployguard";

  try {
    await prisma.verifiedRemediationArtifact.create({
      data: {
        id: artifactId,
        repositoryIdentity,
        format: "unified_diff",
        sha256: "a".repeat(64),
        byteSize: 4,
        content: "test",
      },
    });

    await prisma.remediationDelivery.create({
      data: {
        id: deliveryId,
        artifactId,
        status: "PUSHED",
        repositoryIdentity,
        originalHead: "b".repeat(40),
        branchName: `deployguard/${suffix}`,
        preparedDiffSha256: "c".repeat(64),
        sourceBranch: "main",
      },
    });

    const claims = await Promise.all(
      Array.from({ length: 10 }, () =>
        claimPullRequestDelivery(deliveryId, repositoryIdentity),
      ),
    );

    const successfulClaims = claims.filter(Boolean).length;

    if (successfulClaims !== 1) {
      throw new Error(
        `Expected one successful claim, received ${successfulClaims}`,
      );
    }

    console.log("PASS: only one repository claim succeeded");

    const transitions = await Promise.all(
      Array.from({ length: 10 }, () =>
        markPullRequestPostAttempted(deliveryId),
      ),
    );

    if (transitions.filter(Boolean).length !== 1) {
      throw new Error("Expected exactly one successful transition");
    }

    console.log("PASS: only one repository transition succeeded");

    const recorded = await getDurablePullRequestDelivery(deliveryId);

    if (recorded?.status !== "POST_ATTEMPTED") {
      throw new Error("Expected durable POST_ATTEMPTED state");
    }

    console.log("PASS: durable state verified");

    const persisted = await persistVerifiedPullRequest(
      deliveryId,
      repositoryIdentity,
      12345,
      `https://github.com/${repositoryIdentity}/pull/12345`,
      "open",
      false,
    );

    if (!persisted) {
      throw new Error("Failed to persist verified PR identity");
    }

    const verified = await getDurablePullRequestDelivery(deliveryId);

    if (verified?.status !== "VERIFIED" || verified.prNumber !== 12345) {
      throw new Error("Verified PR record does not match");
    }

    console.log("PASS: verified PR identity persisted");
  } finally {
    await prisma.gitHubPullRequestDelivery.deleteMany({
      where: { deliveryId },
    });
    await prisma.remediationDelivery.deleteMany({
      where: { id: deliveryId },
    });
    await prisma.verifiedRemediationArtifact.deleteMany({
      where: { id: artifactId },
    });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
