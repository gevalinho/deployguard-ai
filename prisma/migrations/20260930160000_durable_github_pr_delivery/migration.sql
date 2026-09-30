CREATE TYPE "GitHubPullRequestDeliveryStatus" AS ENUM ('CLAIMED', 'POST_ATTEMPTED', 'VERIFIED');

CREATE TABLE "GitHubPullRequestDelivery" (
  "deliveryId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'github',
  "repositoryIdentity" TEXT NOT NULL,
  "status" "GitHubPullRequestDeliveryStatus" NOT NULL DEFAULT 'CLAIMED',
  "prNumber" INTEGER,
  "prUrl" TEXT,
  "prState" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "reconciledAt" TIMESTAMP(3),
  CONSTRAINT "GitHubPullRequestDelivery_pkey" PRIMARY KEY ("deliveryId")
);

CREATE UNIQUE INDEX "GitHubPullRequestDelivery_provider_repositoryIdentity_prNumber_key"
  ON "GitHubPullRequestDelivery"("provider", "repositoryIdentity", "prNumber");
CREATE INDEX "GitHubPullRequestDelivery_status_idx" ON "GitHubPullRequestDelivery"("status");
ALTER TABLE "GitHubPullRequestDelivery"
  ADD CONSTRAINT "GitHubPullRequestDelivery_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "RemediationDelivery"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
