ALTER TABLE "VerifiedRemediationArtifact"
ADD COLUMN "sourceCommitSha" TEXT,
ADD COLUMN "sourceBranch" TEXT,
ADD COLUMN "ingestionSource" TEXT,
ADD COLUMN "ingestionRemoteVerified" BOOLEAN NOT NULL DEFAULT false;
