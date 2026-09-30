import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "@/lib/database/prisma";
import { createInstallationAccessToken } from "@/lib/remediation/github-app-auth";
import { getRemediationDelivery, type RemediationDeliveryMetadata } from "@/lib/remediation/remediation-delivery-repository";

const REPOSITORY = "gevalinho/deployguard-lint-fixture";
const DELIVERY_ID = "cmunyaeb30001wd0jxifmmbw9";
const OWNER = "gevalinho";
const NAME = "deployguard-lint-fixture";
const API = `https://api.github.com/repos/${REPOSITORY}`;

type Pull = {
  number?: unknown; state?: unknown; html_url?: unknown;
  head?: { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } };
  base?: { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } };
};
type VerifiedPull = {
  number: number; state: "open" | "closed"; url: string;
  baseBranch: string; baseSha: string; headBranch: string; headSha: string;
};
export type Reconciliation =
  | { status: "NONE" | "AMBIGUOUS" }
  | { status: "ONE"; pull: VerifiedPull };

export function classifyPullRequests(
  listed: unknown,
  detail: unknown,
  delivery: Pick<RemediationDeliveryMetadata,
    "repositoryIdentity" | "status" | "sourceBranch" | "originalHead" | "branchName" | "commitSha">,
): Reconciliation {
  if (delivery.status !== "PUSHED" || !delivery.commitSha ||
      delivery.repositoryIdentity !== REPOSITORY || delivery.sourceBranch !== "main") {
    return { status: "AMBIGUOUS" };
  }
  if (!Array.isArray(listed) || listed.length > 1) return { status: "AMBIGUOUS" };
  if (listed.length === 0) return { status: "NONE" };
  const summary = listed[0] as Pull;
  const pull = detail as Pull | null;
  if (!pull || !Number.isSafeInteger(pull.number) || typeof pull.number !== "number" || pull.number <= 0 ||
      summary.number !== pull.number ||
      (pull.state !== "open" && pull.state !== "closed") ||
      pull.html_url !== `https://github.com/${REPOSITORY}/pull/${pull.number}` ||
      pull.base?.repo?.full_name !== delivery.repositoryIdentity ||
      pull.head?.repo?.full_name !== delivery.repositoryIdentity ||
      pull.base.ref !== delivery.sourceBranch || pull.base.sha !== delivery.originalHead ||
      pull.head.ref !== delivery.branchName || pull.head.sha !== delivery.commitSha) {
    return { status: "AMBIGUOUS" };
  }
  return { status: "ONE", pull: {
    number: pull.number, state: pull.state, url: pull.html_url as string,
    baseBranch: pull.base.ref as string, baseSha: pull.base.sha as string,
    headBranch: pull.head.ref as string, headSha: pull.head.sha as string,
  } };
}

async function read(path: string, token: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!response.ok) throw new Error("GitHub read failed");
  return response.json();
}

/** Importing this module never starts reconciliation. No PR mutation path exists here. */
export async function runPullRequestReconciliation(): Promise<boolean> {
  let stage = "configuration";
  try {
    assert.equal(process.env.DEPLOYGUARD_PR_RECONCILE_DELIVERY_ID, DELIVERY_ID);
    stage = "delivery_lookup";
    const delivery = await getRemediationDelivery(DELIVERY_ID);
    assert(delivery && delivery.status === "PUSHED" && delivery.commitSha &&
      delivery.repositoryIdentity === REPOSITORY && delivery.sourceBranch === "main");
    stage = "github_app_authorization";
    const access = await createInstallationAccessToken(OWNER, NAME, { pull_requests: "read" });
    assert.equal(access.repositoryIdentity, REPOSITORY);
    assert(Date.parse(access.expiresAt) > Date.now());
    stage = "github_pr_list";
    const query = new URLSearchParams({ state: "all", head: `${OWNER}:${delivery.branchName}`,
      base: delivery.sourceBranch, per_page: "2" });
    const listed = await read(`/pulls?${query}`, access.token);
    let detail: unknown = null;
    if (Array.isArray(listed) && listed.length === 1 &&
        Number.isSafeInteger(listed[0]?.number) && listed[0].number > 0) {
      stage = "github_pr_detail";
      detail = await read(`/pulls/${listed[0].number}`, access.token);
    }
    stage = "reconciliation";
    const result = classifyPullRequests(listed, detail, delivery);
    console.log(`PR_RECONCILIATION=${result.status}`);
    if (result.status === "ONE") {
      console.log(`PR_NUMBER=${result.pull.number}`);
      console.log(`PR_STATE=${result.pull.state}`);
      console.log(`PR_HTML_URL=${result.pull.url}`);
      console.log(`PR_BASE_BRANCH=${result.pull.baseBranch}`);
      console.log(`PR_BASE_SHA=${result.pull.baseSha}`);
      console.log(`PR_HEAD_BRANCH=${result.pull.headBranch}`);
      console.log(`PR_HEAD_SHA=${result.pull.headSha}`);
    }
    return true;
  } catch {
    // Never print provider exceptions, authenticated headers, or response bodies.
    console.error(`FAILED_STAGE=${stage}`);
    return false;
  } finally {
    try { await prisma.$disconnect(); } catch { /* No raw cleanup error. */ }
  }
}

if (require.main === module) {
  void runPullRequestReconciliation().then((passed) => {
    if (!passed) process.exitCode = 1;
  });
}
