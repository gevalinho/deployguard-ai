import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
function stub(path: string, exports: Record<string, unknown>) {
  const id = require.resolve(path);
  const cachedModule = new Module(id);
  cachedModule.exports = exports;
  require.cache[id] = cachedModule;
}
const repositoryIdentity = "gevalinho/deployguard-lint-fixture";
const branchName = "deployguard/remediation-9c9b23d4566b";
const originalHead = "b33ebd64a696b5792e0cd459161fb2f8bc319125";
const commitSha = "57b64cc5fd7452ab9daf3b34253a45c9cee4a0e6";
const delivery = { id: "cmunyaeb30001wd0jxifmmbw9", status: "PUSHED" as const,
  repositoryIdentity, sourceBranch: "main", originalHead, branchName, commitSha };
const pull = () => ({ number: 42, state: "open",
  html_url: `https://github.com/${repositoryIdentity}/pull/42`,
  base: { ref: "main", sha: originalHead, repo: { full_name: repositoryIdentity } },
  head: { ref: branchName, sha: commitSha, repo: { full_name: repositoryIdentity } },
});
const secret = "SECRET_TOKEN Authorization: Bearer secret https://user:password@github.com";
let listed: unknown = [], detail: unknown = pull(), fail = "", calls = 0;
const output: string[] = [];
const oldFetch = globalThis.fetch, oldEnv = { ...process.env };
const log = console.log, error = console.error;
stub("dotenv/config", {});
stub("@/lib/database/prisma", { prisma: { async $disconnect() {} } });
stub("@/lib/remediation/remediation-delivery-repository", {
  async getRemediationDelivery(id: string) { calls++; assert.equal(id, delivery.id); return delivery; },
});
stub("@/lib/remediation/github-app-auth", {
  async createInstallationAccessToken(owner: string, repo: string, permissions: unknown) {
    calls++;
    assert.equal(`${owner}/${repo}`, repositoryIdentity);
    assert.deepEqual(permissions, { pull_requests: "read" });
    if (fail === "github_app_authorization") throw new Error(secret);
    return { token: secret, repositoryIdentity, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  },
});
globalThis.fetch = async (input, init) => {
  calls++;
  assert.equal(init?.method, "GET");
  assert.equal(init?.redirect, "error");
  assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${secret}`);
  const url = String(input);
  assert(url.startsWith(`https://api.github.com/repos/${repositoryIdentity}/pulls`));
  if (url.includes("/pulls?")) {
    assert(url.includes("state=all"));
    assert(url.includes("head=gevalinho%3Adeployguard%2Fremediation-9c9b23d4566b"));
    assert(url.includes("base=main"));
    if (fail === "github_pr_list") throw new Error(secret);
    return Response.json(listed);
  }
  assert(url.endsWith("/pulls/42"));
  if (fail === "github_pr_detail") throw new Error(secret);
  return Response.json(detail);
};
console.log = (...args) => { output.push(args.join(" ")); };
console.error = (...args) => { output.push(args.join(" ")); };
const { classifyPullRequests, runPullRequestReconciliation } = require("./scripts/reconcile-real-github-app-pull-request") as typeof import("./reconcile-real-github-app-pull-request");
async function main() {
  assert.deepEqual(classifyPullRequests([], null, delivery), { status: "NONE" });
  assert.equal(classifyPullRequests([pull()], pull(), delivery).status, "ONE");
  assert.equal(classifyPullRequests([pull(), pull()], null, delivery).status, "AMBIGUOUS");
  assert.equal(classifyPullRequests([pull()], { ...pull(), head: { ...pull().head, sha: "0".repeat(40) } }, delivery).status, "AMBIGUOUS");
  assert.equal(classifyPullRequests([pull()], { ...pull(), base: { ...pull().base, sha: "0".repeat(40) } }, delivery).status, "AMBIGUOUS");
  assert.equal(classifyPullRequests([pull()], { ...pull(), html_url: "https://evil.example/pr" }, delivery).status, "AMBIGUOUS");
  assert.equal(classifyPullRequests([pull()], pull(), { ...delivery, status: "COMMITTED" }).status, "AMBIGUOUS");
  process.env.DEPLOYGUARD_PR_RECONCILE_DELIVERY_ID = delivery.id;
  listed = [];
  assert.equal(await runPullRequestReconciliation(), true);
  assert(output.includes("PR_RECONCILIATION=NONE"));
  output.length = 0;
  listed = [pull()];
  detail = pull();
  assert.equal(await runPullRequestReconciliation(), true);
  assert(output.includes("PR_RECONCILIATION=ONE"));
  assert(output.includes("PR_NUMBER=42"));
  output.length = 0;
  listed = [pull(), pull()];
  assert.equal(await runPullRequestReconciliation(), true);
  assert(output.includes("PR_RECONCILIATION=AMBIGUOUS"));
  for (const stage of ["github_app_authorization", "github_pr_list", "github_pr_detail"]) {
    listed = [pull()];
    fail = stage;
    output.length = 0;
    assert.equal(await runPullRequestReconciliation(), false);
    assert(output.includes(`FAILED_STAGE=${stage}`));
    assert(!output.join(" ").includes(secret));
  }
  assert(calls > 0);
  globalThis.fetch = oldFetch; process.env = oldEnv; console.log = log; console.error = error;
  log("PR reconciliation tests passed (stubbed; GET only).");
}
void main().catch(() => { globalThis.fetch = oldFetch; process.env = oldEnv; console.log = log; console.error = error; process.exitCode = 1; });
