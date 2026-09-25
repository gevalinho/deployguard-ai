-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RemediationDeliveryStatus" AS ENUM ('PREPARED', 'COMMITTED', 'PUSHED', 'FAILED');

-- CreateTable
CREATE TABLE "VerifiedRemediationArtifact" (
    "id" TEXT NOT NULL,
    "repositoryIdentity" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifiedRemediationArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemediationDelivery" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "status" "RemediationDeliveryStatus" NOT NULL DEFAULT 'PREPARED',
    "repositoryIdentity" TEXT NOT NULL,
    "originalHead" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "preparedDiffSha256" TEXT NOT NULL,
    "commitSha" TEXT,
    "remoteName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "committedAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),

    CONSTRAINT "RemediationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerifiedRemediationArtifact_sha256_idx" ON "VerifiedRemediationArtifact"("sha256");

-- CreateIndex
CREATE INDEX "VerifiedRemediationArtifact_repositoryIdentity_idx" ON "VerifiedRemediationArtifact"("repositoryIdentity");

-- CreateIndex
CREATE INDEX "VerifiedRemediationArtifact_createdAt_idx" ON "VerifiedRemediationArtifact"("createdAt");

-- CreateIndex
CREATE INDEX "RemediationDelivery_artifactId_idx" ON "RemediationDelivery"("artifactId");

-- CreateIndex
CREATE INDEX "RemediationDelivery_repositoryIdentity_idx" ON "RemediationDelivery"("repositoryIdentity");

-- CreateIndex
CREATE INDEX "RemediationDelivery_status_idx" ON "RemediationDelivery"("status");

-- CreateIndex
CREATE INDEX "RemediationDelivery_commitSha_idx" ON "RemediationDelivery"("commitSha");

-- CreateIndex
CREATE INDEX "RemediationDelivery_createdAt_idx" ON "RemediationDelivery"("createdAt");

-- AddForeignKey
ALTER TABLE "RemediationDelivery" ADD CONSTRAINT "RemediationDelivery_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "VerifiedRemediationArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

