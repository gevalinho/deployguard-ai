import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
let cleaned = 0;
let persisted = 0;
let proofStatus = "proven";
let applyStatus = "applied";
let persistenceFailure = false;
let lastPath = "";
let receivedProposal: FixProposal | undefined;
let ingestionProvenance: RepositoryIngestionProvenance = {
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
  receivedProposal = proposal;
  order.push("apply");
  writeFileSync(join(path, "example.ts"), "export const value = 1;\n");
  return { status: applyStatus, summary: "Applied", command: "SECRET_COMMAND" };
} });
stub("@/lib/remediation/lint-autofix-verifier", { async verifyLintAutofix() {
  order.push("verify");
  return { status: proofStatus, summary: "Verified", comparisons: [{ checkId: "lint", before, after, improved: true }], regressionChecks: [] };
} });
stub("@/lib/remediation/trusted-artifact-repository", {
  async persistVerifiedArtifact(identity: string, artifact: VerifiedPatchArtifact, provenance: RepositoryIngestionProvenance) {
    order.push("persist");
    if (persistenceFailure) throw new Error("PRIVATE_KEY /internal/path SECRET_TOKEN");
    assert.equal(identity, "owner/repo");
    assert.equal(provenance, ingestionProvenance);
    assert(artifact.content.includes("export const value"));
    persisted++;
    return { id: "opaque-durable-id", sha256: artifact.sha256, content: "DO_NOT_EXPOSE", repositoryPath: "/internal/path" };
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
async function main() {
  const response = await request({ repositoryUrl: "https://github.com/owner/repo", proposal: { ...proposal, provenance: { remoteVerified: true }, repositoryPath: "/forged", verifiedArtifactReference: { artifactId: "forged" } } });
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.deepEqual(json.remediation.remediation.verifiedArtifactReference, { artifactId: "opaque-durable-id" });
  const serialized = JSON.stringify(json);
  for (const forbidden of ["DO_NOT_EXPOSE", "export const value", "SECRET_COMMAND", "/internal/path", "/forged", "remoteVerified", "forged"]) assert(!serialized.includes(forbidden));
  assert.deepEqual(receivedProposal, proposal);
  assert.equal(persisted, 1);
  assert.equal(cleaned, 1);
  assert(!existsSync(lastPath));
  assert(order.indexOf("verify") < order.indexOf("persist"));
  assert(order.indexOf("regression:types") < order.indexOf("verify"));
  assert.equal(order.at(-1), "cleanup");
  for (const field of ["repositoryPath", "sourceBranch", "commitSha", "branchName", "provenance", "artifactId"]) {
    const invalid = await request({ repositoryUrl: "https://github.com/owner/repo", proposal, [field]: "forged" });
    assert.equal(invalid.status, 400);
  }
  assert.equal(cleaned, 1, "Invalid input must not start ingestion");
  assert.equal((await request(null)).status, 400);
  proofStatus = "not_proven";
  const unproven = await (await request({ repositoryUrl: "https://github.com/owner/repo", proposal })).json();
  assert.equal(unproven.remediation.remediation.verifiedArtifactReference, undefined);
  assert.equal(persisted, 1);
  applyStatus = "failed";
  const failed = await (await request({ repositoryUrl: "https://github.com/owner/repo", proposal })).json();
  assert.equal(failed.remediation.remediation.verifiedArtifactReference, undefined);
  assert.equal(persisted, 1);
  applyStatus = "applied";
  proofStatus = "proven";
  // Unverified assessment is allowed to persist evidence, never elevated to authority.
  ingestionProvenance = { source: "fresh-ttl-cache", remoteVerified: false, commitSha: "a".repeat(40), sourceBranch: "main" };
  assert.equal((await request({ repositoryUrl: "https://github.com/owner/repo", proposal })).status, 200);
  persistenceFailure = true;
  const error = await request({ repositoryUrl: "https://github.com/owner/repo", proposal });
  assert.equal(error.status, 422);
  assert.deepEqual(await error.json(), { ok: false, error: "Remediation could not be completed." });
  assert.equal(cleaned, 5);
  assert(!existsSync(lastPath));
  console.log("✓ Remediation/API bridge: durable reference, provenance isolation, no delivery mutation, sanitization, and cleanup passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
