CREATE TABLE "RemediationDeliveryRequest" (
  "artifactId" TEXT NOT NULL,
  "developerGitHubId" TEXT NOT NULL,
  "repositoryIdentity" TEXT NOT NULL,
  "deliveryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RemediationDeliveryRequest_pkey" PRIMARY KEY ("artifactId")
);
CREATE UNIQUE INDEX "RemediationDeliveryRequest_deliveryId_key" ON "RemediationDeliveryRequest"("deliveryId");
ALTER TABLE "RemediationDeliveryRequest" ADD CONSTRAINT "RemediationDeliveryRequest_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "VerifiedRemediationArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
