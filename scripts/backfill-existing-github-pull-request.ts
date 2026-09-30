import "dotenv/config";
import { prisma } from "@/lib/database/prisma";
import { recoverExistingGitHubPullRequest } from "@/lib/remediation/github-pull-request-recovery";
import { getRemediationDelivery } from "@/lib/remediation/remediation-delivery-repository";

const DELIVERY_ID = "cmunyaeb30001wd0jxifmmbw9";
const REPOSITORY = "gevalinho/deployguard-lint-fixture";
const ARTIFACT_ID = "cmunx3kdh0000wd2vjkz8tpif";
const BASE_SHA = "b33ebd64a696b5792e0cd459161fb2f8bc319125";
const HEAD_BRANCH = "deployguard/remediation-9c9b23d4566b";
const HEAD_SHA = "57b64cc5fd7452ab9daf3b34253a45c9cee4a0e6";

/** Explicit, fixture-pinned database backfill. It has no GitHub write method. */
export async function runExistingPullRequestBackfill(): Promise<boolean> {
  let stage = "configuration";
  try {
    if (process.env.DEPLOYGUARD_PR_BACKFILL !== "1" ||
        process.env.DEPLOYGUARD_PR_BACKFILL_DELIVERY_ID !== DELIVERY_ID) {
      throw new Error("Not opted in");
    }
    stage = "delivery_identity";
    const delivery = await getRemediationDelivery(DELIVERY_ID);
    if (!delivery || delivery.status !== "PUSHED" || delivery.repositoryIdentity !== REPOSITORY ||
        delivery.artifactId !== ARTIFACT_ID || delivery.sourceBranch !== "main" ||
        delivery.originalHead !== BASE_SHA || delivery.branchName !== HEAD_BRANCH ||
        delivery.commitSha !== HEAD_SHA) throw new Error("Delivery identity mismatch");
    stage = "recovery";
    const result = await recoverExistingGitHubPullRequest(DELIVERY_ID, 1);
    if (result.status !== "recovered" && result.status !== "already_verified") {
      console.error(`RECOVERY_STATUS=${result.status}`);
      return false;
    }
    if (result.number !== 1 || result.url !== `https://github.com/${REPOSITORY}/pull/1`) {
      console.error("RECOVERY_STATUS=identity_mismatch");
      return false;
    }
    console.log(`RECOVERY_STATUS=${result.status}`);
    console.log(`PR_NUMBER=${result.number}`);
    console.log(`PR_URL=${result.url}`);
    return true;
  } catch {
    console.error(`FAILED_STAGE=${stage}`);
    return false;
  } finally {
    try { await prisma.$disconnect(); } catch { /* No raw database error. */ }
  }
}

if (require.main === module) {
  void runExistingPullRequestBackfill().then((passed) => {
    if (!passed) process.exitCode = 1;
  });
}
