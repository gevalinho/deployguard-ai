import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepositoryIngestionProvenance } from "@/lib/repository/repository-ingestion";
import type { FixProposal } from "@/lib/remediation/types";
import type { VerifiedPatchArtifact } from "@/lib/remediation/verified-patch-artifact";

// Stub external execution, keeping the real route, orchestration, patch creation,
// persistence gate, and public sanitizer. No network, sandbox runtime, or Git writes.
const require = createRequire(join(process.cwd(), "package.json"));
function stub(path: string, exports: Record<string, unknown>) {
  const id = require.resolve(path);
  const cachedModule = new Module(id);
  cachedModule.exports = exports;
  require.cache[id] = cachedModule;
}
import type { TrustedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";
import type { RemediationDeliveryMetadata } from "@/lib/remediation/remediation-delivery-repository";
import type { DurablePullRequestDelivery } from "@/lib/remediation/github-pull-request-repository";
let stored: TrustedArtifactMetadata;
let delivery: RemediationDeliveryMetadata | null = null;
let prRow: DurablePullRequestDelivery | null = null;
let cleaned = 0;
let persisted = 0;
const proofStatus = "proven";
const applyStatus = "applied";
const persistenceFailure = false;
let lastPath = "";

const ingestionProvenance: RepositoryIngestionProvenance = {
  source: "fresh-remote", remoteVerified: true, commitSha: "a".repeat(40), sourceBranch: "main",
};
const before = { id: "lint", name: "Lint", category: "lint", status: "failed", summary: "Failed", evidence: [] };
const after = { ...before, status: "passed" };
const order: string[] = [];
stub("@/lib/repository/repository-ingestion", {
  async ingestGitHubRepository(repository: unknown) {
    order.push("ingest");
    lastPath = mkdtempSync(join(tmpdir(), "dg-bridge-"));
    writeFileSync(join(lastPath, "example.ts"), "export const value=1;\n");
    return { repository, repositoryPath: lastPath, provenance: ingestionProvenance,
      cleanup() { cleaned++; order.push("cleanup"); rmSync(lastPath, { recursive: true, force: true }); } };
  },
});
stub("@/lib/sandbox/workspace-preparation", { async prepareSandboxWorkspace() { return { status: "passed" }; } });
for (const [file, name, id] of [
  ["sandbox-typecheck-agent", "runSandboxTypecheckAgent", "types"],
  ["sandbox-test-agent", "runSandboxTestAgent", "tests"],
  ["sandbox-build-agent", "runSandboxBuildAgent", "build"],
]) {
  stub(`@/lib/agents/${file}`, { [name]: async () => {
    order.push(`regression:${id}`);
    return { id, category: id, name: id, status: "passed", summary: "Passed" };
  } });
}
stub("@/lib/agents/sandbox-lint-agent", { async runSandboxLintAgent() { return before; } });
stub("@/lib/agents/sandbox-security-agent", { async runSandboxSecurityAgent() { throw new Error("Unexpected strategy"); } });
stub("@/lib/remediation/lint-autofix-fixer", { async applyLintAutofix(path: string, proposal: FixProposal) {
  assert.equal(proposal.strategy, "lint_autofix");
  order.push("apply");
  writeFileSync(join(path, "example.ts"), "export const value = 1;\n");
  return { status: applyStatus, summary: "Applied", command: "SECRET_COMMAND" };
} });
stub("@/lib/remediation/lint-autofix-verifier", { async verifyLintAutofix() {
  order.push("verify");
  return { status: proofStatus, summary: "Verified", comparisons: [{ checkId: "lint", before, after, improved: true }], regressionChecks: [] };
} });
stub("@/lib/remediation/trusted-artifact-repository", {
  async getVerifiedArtifactMetadata() { return stored; },
  async persistVerifiedArtifact(identity: string, artifact: VerifiedPatchArtifact, provenance: RepositoryIngestionProvenance) {
    order.push("persist");
    if (persistenceFailure) throw new Error("PRIVATE_KEY /internal/path SECRET_TOKEN");
    assert.equal(identity, "owner/repo");
    assert.equal(provenance, ingestionProvenance);
    assert(artifact.content.includes("export const value"));
    persisted++;
    stored = { id: "artifact123", repositoryIdentity: identity, sha256: artifact.sha256, byteSize: artifact.byteSize,
      format: artifact.format, createdAt: new Date(), sourceCommitSha: provenance.commitSha,
      sourceBranch: provenance.sourceBranch, ingestionSource: provenance.source, ingestionRemoteVerified: provenance.remoteVerified };
    return stored;
  },
});
const forbidden = () => { throw new Error("Remediation attempted delivery/Git mutation"); };
stub("@/lib/remediation/remediation-delivery-pipeline", {
  preparePersistedRemediationDelivery: forbidden,
  commitPersistedRemediationDelivery: forbidden,
  pushPersistedRemediationDelivery: forbidden,
});
stub("@/lib/execution/command-runner", { runCommand: forbidden });
const { POST } = require("@/app/api/remediation/route") as typeof import("@/app/api/remediation/route");
const proposal: FixProposal = { id: "lint-fix", title: "Fix lint", description: "Controlled fix", strategy: "lint_autofix", risk: "safe", target: { checkId: "lint", category: "lint", evidenceIndexes: [] } };
const request = (body: unknown) => POST(new Request("http://localhost/api/remediation", { method: "POST", body: JSON.stringify(body) }));

let posts = 0, pushCalls = 0, claim = false;
let remoteExists = false, timeout = false, failPersist = false;
let remoteBase = "a".repeat(40), remoteHead = "c".repeat(40);
stub("@/lib/remediation/remediation-delivery-repository", { async getRemediationDelivery() { return delivery; } });
stub("@/lib/remediation/github-app-auth", { async createInstallationAccessToken() {
  return { token: "SECRET_TOKEN", repositoryIdentity: "owner/repo", expiresAt: new Date(Date.now() + 60000).toISOString() };
} });
stub("@/lib/remediation/github-pull-request-repository", {
  async getDurablePullRequestDelivery() { return prRow; },
  async claimPullRequestDelivery() {
    if (prRow) return false;
    prRow = { deliveryId: delivery!.id, repositoryIdentity: "owner/repo", provider: "github", status: "CLAIMED",
      prNumber: null, prUrl: null, prState: null, createdAt: new Date(), attemptedAt: null, verifiedAt: null, reconciledAt: null };
    return true;
  },
  async markPullRequestPostAttempted() {
    if (prRow?.status !== "CLAIMED") return false;
    prRow.status = "POST_ATTEMPTED"; prRow.attemptedAt = new Date(); return true;
  },
  async persistVerifiedPullRequest(_id: string, _repo: string, number: number, url: string, state: string) {
    if (failPersist || !prRow) return false;
    Object.assign(prRow, { status: "VERIFIED", prNumber: number, prUrl: url, prState: state, verifiedAt: new Date() }); return true;
  },
});
const { handleDeveloperDeliveryPost, handleDeveloperDeliveryGet, deliveryApiDependencies } = require("@/lib/remediation/developer-delivery-api") as typeof import("@/lib/remediation/developer-delivery-api");
const { handleDeveloperPullRequestPost } = require("@/lib/remediation/developer-pull-request-api") as typeof import("@/lib/remediation/developer-pull-request-api");
const { createVerifiedGitHubPullRequest } = require("@/lib/remediation/github-pull-request-delivery") as typeof import("@/lib/remediation/github-pull-request-delivery");
const dependencies: import("@/lib/remediation/developer-delivery-api").DeliveryApiDependencies = {
  ...deliveryApiDependencies,
  session: () => ({ githubId: "123", login: "developer", expiresAt: Date.now() + 60000 }), authorize: async () => true,
  claim: async () => {
    if (claim) return delivery ? { kind: "existing", delivery } : { kind: "pending" };
    claim = true; return { kind: "acquired", claim: { artifactId: stored.id, repositoryIdentity: stored.repositoryIdentity, deliveryId: null } };
  },
  attach: async () => true,
  workspace: async () => ({ path: "/tmp/stub", provenance: ingestionProvenance, cleanup: async () => {} }),
  reverify: async () => true,
  prepare: async (_path, identity, artifactId) => {
    assert.equal(cleaned, 1); assert.equal(persisted, 1);
  assert.equal(artifactId, stored.id);
    delivery = { id: "delivery123", artifactId, repositoryIdentity: identity, originalHead: stored.sourceCommitSha!,
      sourceBranch: "main", branchName: `deployguard/remediation-${stored.sha256.slice(0, 12)}`,
      preparedDiffSha256: "d".repeat(64), status: "PREPARED", commitSha: null, remoteName: null,
      createdAt: new Date(), updatedAt: new Date(), committedAt: null, pushedAt: null };
    return { status: "prepared", artifactId, delivery, summary: "prepared" };
  },
  commit: async () => {
    delivery = { ...delivery!, status: "COMMITTED", commitSha: remoteHead, committedAt: new Date() };
    return { status: "committed", deliveryId: delivery.id, delivery, summary: "committed" };
  },
  push: async () => {
    pushCalls++; delivery = { ...delivery!, status: "PUSHED", remoteName: "origin", pushedAt: new Date() };
    return { status: "pushed", delivery, summary: "pushed" };
  },
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  assert(url.startsWith("https://api.github.com/repos/owner/repo/"));
  const pull = { number: 1, html_url: "https://github.com/owner/repo/pull/1", state: "open",
    head: { ref: delivery!.branchName, sha: delivery!.commitSha, repo: { full_name: "owner/repo" } },
    base: { ref: "main", sha: delivery!.originalHead, repo: { full_name: "owner/repo" } } };
  if (url.includes("/branches/main")) return Response.json({ name: "main", commit: { sha: remoteBase } });
  if (url.includes("/branches/")) return Response.json({ name: delivery!.branchName, commit: { sha: remoteHead } });
  if (url.includes("/pulls?")) return Response.json(remoteExists ? [pull] : []);
  if (url.endsWith("/pulls/1")) return Response.json(pull);
  assert.equal(init?.method, "POST"); assert.equal(prRow?.status, "POST_ATTEMPTED"); posts++;
  if (timeout) throw new Error("SECRET_TOKEN uncertain POST");
  remoteExists = true; return Response.json(pull);
};
const post = (body: unknown) => new Request("https://deployguard.test/api/remediation/delivery", {
  method: "POST", headers: { origin: "https://deployguard.test" }, body: JSON.stringify(body),
});
const createPr = () => handleDeveloperPullRequestPost(post({ confirmPullRequest: true }), "delivery123",
  { ...dependencies, create: createVerifiedGitHubPullRequest });
async function main() {
  const generated = await request({ repositoryUrl: "https://github.com/owner/repo", proposal });
  assert.equal(generated.status, 200);
  const artifactId = (await generated.json()).remediation.remediation.verifiedArtifactReference.artifactId;
  assert.equal(cleaned, 1); assert.equal(persisted, 1);
  assert.equal(artifactId, stored.id); assert.equal(pushCalls, 0); assert.equal(posts, 0);
  const delivered = await handleDeveloperDeliveryPost(post({ artifactId, confirmDelivery: true }), dependencies);
  assert.equal(delivered.status, 201); assert.equal((await delivered.json()).delivery.status, "PUSHED");
  assert.equal(pushCalls, 1); assert.equal(posts, 0, "Delivery never creates a PR");
  assert.equal((await handleDeveloperDeliveryPost(post({ artifactId, confirmDelivery: true }), dependencies)).status, 200);
  assert.equal(pushCalls, 1);
  remoteBase = "e".repeat(40); assert.equal((await (await createPr()).json()).code, "base_head_mismatch"); assert.equal(posts, 0);
  remoteBase = delivery!.originalHead;
  remoteHead = "f".repeat(40); assert.equal((await (await createPr()).json()).code, "head_commit_mismatch"); assert.equal(posts, 0);
  remoteHead = delivery!.commitSha!;
  const concurrent = await Promise.all([createPr(), createPr()]);
  assert(concurrent.some(response => response.status === 201)); assert.equal(posts, 1);
  assert.equal((await createPr()).status, 200); assert.equal(posts, 1);
  const status = await handleDeveloperDeliveryGet(new Request("https://deployguard.test"), "delivery123", dependencies);
  assert.equal((await status.json()).delivery.pullRequest.url, "https://github.com/owner/repo/pull/1");
  // Isolated crash scenario: a lost POST is never automatically repeated.
  prRow = null; remoteExists = false; timeout = true;
  assert.equal((await (await createPr()).json()).code, "recovery_required"); const attempted = posts;
  assert.equal((await (await createPr()).json()).code, "recovery_required"); assert.equal(posts, attempted);
  remoteExists = true; failPersist = true;
  assert.equal((await (await createPr()).json()).code, "persistence_failed"); assert.equal(posts, attempted);
  failPersist = false;
  assert.equal((await createPr()).status, 200); assert.equal(posts, attempted);
  console.log("Composed remediation → delivery → real PR engine tests passed (external operations stubbed).");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
