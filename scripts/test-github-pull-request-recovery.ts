import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { join } from "node:path";
const require = createRequire(join(process.cwd(), "package.json"));
function stub(path: string, exports: Record<string, unknown>) {
  const id = require.resolve(path); const cachedModule = new Module(id);
  cachedModule.exports = exports; require.cache[id] = cachedModule;
}
const repo = "gevalinho/deployguard-lint-fixture";
const deliveryId = "cmunyaeb30001wd0jxifmmbw9";
const artifactId = "cmunx3kdh0000wd2vjkz8tpif";
const baseSha = "b33ebd64a696b5792e0cd459161fb2f8bc319125";
const headSha = "57b64cc5fd7452ab9daf3b34253a45c9cee4a0e6";
const artifactSha = "9c9b23d4566b966be68e4be67469c63c8f8aced4c3be61b2bf0778d2541a0150";
const headBranch = "deployguard/remediation-9c9b23d4566b";
const secret = "SECRET_TOKEN Authorization: Bearer secret private-key";
let deliveryRepo = repo, artifactRepo = repo, artifactSource = "verified-cache";
let deliveryStatus = "PUSHED", remoteBase = baseSha, remoteHead = headSha;
let list: "one" | "none" | "many" = "one", fail = "", state: "open" | "closed" = "open";
let prRepo = repo, prBase = baseSha, prHead = headSha, prBaseBranch = "main", prHeadBranch = headBranch;
let row: { deliveryId: string; provider: string; repositoryIdentity: string;
  status: "CLAIMED" | "POST_ATTEMPTED" | "VERIFIED"; prNumber: number | null;
  prUrl: string | null; prState: string | null; verifiedAt: Date | null;
  reconciledAt: Date | null } | null = null;
let claims = 0, writes = 0, gets = 0;
const output: string[] = [];
const oldFetch = globalThis.fetch, oldLog = console.log, oldError = console.error;
const oldEnv = { ...process.env };
stub("dotenv/config", {});
stub("@/lib/database/prisma", { prisma: { async $disconnect() {} } });
stub("@/lib/remediation/remediation-delivery-repository", {
  async getRemediationDelivery(id: string) { assert.equal(id, deliveryId);
    return { id: deliveryId, artifactId, status: deliveryStatus, repositoryIdentity: deliveryRepo,
      sourceBranch: "main", originalHead: baseSha, branchName: headBranch, commitSha: headSha }; },
});
stub("@/lib/remediation/trusted-artifact-repository", {
  async getVerifiedArtifactMetadata(id: string) { assert.equal(id, artifactId);
    return { id: artifactId, repositoryIdentity: artifactRepo, sha256: artifactSha,
      sourceBranch: "main", sourceCommitSha: baseSha,
      ingestionSource: artifactSource, ingestionRemoteVerified: true }; },
});
stub("@/lib/remediation/github-app-auth", {
  async createInstallationAccessToken(owner: string, name: string, permissions: unknown) {
    assert.equal(`${owner}/${name}`, deliveryRepo);
    assert.deepEqual(permissions, { contents: "read", pull_requests: "read" });
    if (fail === "auth") throw new Error(secret);
    return { repositoryIdentity: deliveryRepo, token: secret,
      expiresAt: new Date(Date.now() + 60_000).toISOString() };
  },
});
stub("@/lib/remediation/github-pull-request-repository", {
  async getDurablePullRequestDelivery() { if (fail === "database") throw new Error(secret); return row; },
  async claimPullRequestDelivery() { claims++; if (row) return false;
    row = { deliveryId, provider: "github", repositoryIdentity: repo, status: "CLAIMED",
      prNumber: null, prUrl: null, prState: null, verifiedAt: null, reconciledAt: null };
    return true; },
  async persistVerifiedPullRequest(_id: string, _repo: string, number: number,
    url: string, prState: string, reconciled: boolean) {
    writes++; if (fail === "persist") throw new Error(secret);
    assert.equal(_id, deliveryId); assert.equal(_repo, repo); assert(reconciled);
    assert(row); row.status = "VERIFIED"; row.prNumber = number; row.prUrl = url;
    row.prState = prState; row.verifiedAt = new Date(); row.reconciledAt = new Date();
    return true;
  },
});
function pr() { return { number: 1, state, html_url: `https://github.com/${repo}/pull/1`,
  base: { ref: prBaseBranch, sha: prBase, repo: { full_name: prRepo } },
  head: { ref: prHeadBranch, sha: prHead, repo: { full_name: prRepo } } }; }
globalThis.fetch = async (input, init) => {
  gets++; assert.equal(init?.method, "GET", "Recovery must never POST");
  assert.equal(init.redirect, "error");
  assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${secret}`);
  const url = String(input);
  assert(url.startsWith(`https://api.github.com/repos/${repo}/`));
  if (fail === "network") throw new Error(secret);
  if (url.includes("/branches/main")) return Response.json({ name: "main", commit: { sha: remoteBase } });
  if (url.includes("/branches/deployguard%2F")) return Response.json({ name: headBranch, commit: { sha: remoteHead } });
  if (url.includes("/pulls?")) {
    assert(url.includes("state=all")); assert(url.includes("base=main"));
    return Response.json(list === "none" ? [] : list === "many" ? [pr(), pr()] : [pr()]);
  }
  assert(url.endsWith("/pulls/1")); return Response.json(pr());
};
const { recoverExistingGitHubPullRequest } = require("@/lib/remediation/github-pull-request-recovery") as typeof import("@/lib/remediation/github-pull-request-recovery");
console.log = (...args) => { output.push(args.join(" ")); };
console.error = (...args) => { output.push(args.join(" ")); };
const { runExistingPullRequestBackfill } = require("./scripts/backfill-existing-github-pull-request") as typeof import("./backfill-existing-github-pull-request");
const run = () => recoverExistingGitHubPullRequest(deliveryId, 1);
function reset() {
  deliveryRepo = repo; artifactRepo = repo; artifactSource = "verified-cache";
  deliveryStatus = "PUSHED"; remoteBase = baseSha; remoteHead = headSha;
  list = "one"; fail = ""; state = "open"; prRepo = repo;
  prBase = baseSha; prHead = headSha; prBaseBranch = "main"; prHeadBranch = headBranch;
  row = null; claims = 0; writes = 0; gets = 0; output.length = 0;
}
async function main() {
  reset();
  delete process.env.DEPLOYGUARD_PR_BACKFILL;
  assert.equal(await runExistingPullRequestBackfill(), false);
  assert.equal(gets, 0); assert.equal(writes, 0);
  reset(); assert.equal((await run()).status, "recovered");
  assert.equal(row?.status, "VERIFIED"); assert.equal(row?.prNumber, 1);
  assert(row?.verifiedAt instanceof Date && row?.reconciledAt instanceof Date);
  assert.equal(claims, 1); assert.equal(writes, 1);
  assert.equal((await run()).status, "already_verified");
  assert.equal(claims, 1); assert.equal(writes, 1);
  reset(); state = "closed";
  assert.equal((await run()).status, "recovered");
  assert.equal(row?.prState, "closed");
  reset(); row = { deliveryId, provider: "github", repositoryIdentity: repo, status: "VERIFIED",
    prNumber: 1, prUrl: `https://github.com/${repo}/pull/1`, prState: "open",
    verifiedAt: new Date(), reconciledAt: new Date() };
  assert.equal((await run()).status, "already_verified"); assert.equal(writes, 0);
  reset(); list = "none"; assert.equal((await run()).status, "none"); assert.equal(claims, 0);
  reset(); list = "many"; assert.equal((await run()).status, "ambiguous"); assert.equal(claims, 0);
  for (const mutate of [() => { prBase = "0".repeat(40); }, () => { prHead = "0".repeat(40); },
    () => { prBaseBranch = "develop"; }, () => { prHeadBranch = "other"; },
    () => { prRepo = "other/repo"; }]) {
    reset(); mutate(); assert.equal((await run()).status, "ambiguous"); assert.equal(writes, 0);
  }
  reset(); artifactRepo = "other/repo"; assert.equal((await run()).status, "artifact_denied");
  reset(); artifactSource = "fresh-ttl-cache"; assert.equal((await run()).status, "artifact_denied");
  reset(); deliveryRepo = "other/repo"; assert.equal((await run()).status, "artifact_denied");
  reset(); deliveryStatus = "COMMITTED"; assert.equal((await run()).status, "delivery_denied");
  reset(); remoteBase = "0".repeat(40); assert.equal((await run()).status, "branch_mismatch");
  reset(); remoteHead = "0".repeat(40); assert.equal((await run()).status, "branch_mismatch");
  reset(); row = { deliveryId, provider: "github", repositoryIdentity: repo, status: "VERIFIED",
    prNumber: 2, prUrl: `https://github.com/${repo}/pull/2`, prState: "open",
    verifiedAt: new Date(), reconciledAt: new Date() };
  assert.equal((await run()).status, "durable_conflict"); assert.equal(writes, 0);
  for (const stage of ["auth", "network", "database"]) {
    reset(); fail = stage;
    const result = await run();
    assert(["auth_failed", "github_read_failed", "persistence_failed"].includes(result.status));
    assert(!JSON.stringify(result).includes(secret)); assert.equal(writes, 0);
  }
  reset(); fail = "persist"; assert.equal((await run()).status, "persistence_failed");
  assert.equal(row?.status, "CLAIMED");
  assert(!output.join(" ").includes(secret));
  globalThis.fetch = oldFetch; console.log = oldLog; console.error = oldError; process.env = oldEnv;
  oldLog("GET-only PR recovery tests passed (stubbed; no real mutation).");
}
void main().catch(() => { globalThis.fetch = oldFetch; console.log = oldLog; console.error = oldError; process.env = oldEnv; process.exitCode = 1; });
