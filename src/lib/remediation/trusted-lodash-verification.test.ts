import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckResult } from "@/lib/checks/types";

const docker = vi.hoisted(() => vi.fn());
const reconcile = vi.hoisted(() => vi.fn());
const prepared = vi.hoisted(() => vi.fn());
const verifier = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", async (original) => ({
  ...await original<typeof import("@/lib/sandbox/docker-sandbox")>(),
  runDockerSandboxCommand: docker,
  reconcileSandboxContainer: reconcile,
}));
vi.mock("./frozen-dependency-preparation", () => ({ prepareFrozenNpmDependencies: prepared }));
vi.mock("./dependency-security-verifier", () => ({ verifyDependencySecurityFix: verifier }));
import { verifyTrustedLodashRemediation } from "./trusted-lodash-verification";
import type { TrustedLodashProofContract } from "./frozen-regression-runner";
import { SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";
import { reconcileRetainedArtifact } from "./frozen-artifact-ownership";

const source = `const test = require('node:test');
for (let i = 0; i < 4; i++) test('lodash case ' + i, () => {});`;
const contract: TrustedLodashProofContract = {
  fixture: "lodash-node22", expectedExecutedTests: 4, expectedPassingTests: 4,
  expectedTestNames: ["lodash case 0", "lodash case 1", "lodash case 2", "lodash case 3"],
  expectedTestFiles: [{ path: "test/lodash.test.js",
    sha256: createHash("sha256").update(source).digest("hex") }],
};
const tap = `TAP version 13
# Subtest: lodash case 0
ok 1 - lodash case 0
# Subtest: lodash case 1
ok 2 - lodash case 1
# Subtest: lodash case 2
ok 3 - lodash case 2
# Subtest: lodash case 3
ok 4 - lodash case 3
1..4
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1
`;
const before: CheckResult = { id: "security", category: "security", name: "Audit",
  status: "failed", exitCode: 1, summary: "Finding" };
const roots: string[] = [];
function fixture(testSource: string = source): string {
  const root = mkdtempSync(join(tmpdir(), "dg-orchestrated-lodash-")); roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0",
    private: true, scripts: { test: "node --test" }, dependencies: { lodash: "4.17.21" } }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "fixture", version: "1.0.0",
    lockfileVersion: 3, packages: { "": { name: "fixture", version: "1.0.0",
      dependencies: { lodash: "4.17.21" } },
    "node_modules/lodash": { version: "4.17.21" } } }));
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "test", "lodash.test.js"), testSource);
  return root;
}
afterEach(() => {
  docker.mockReset(); reconcile.mockReset(); prepared.mockReset(); verifier.mockReset();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function arrange() {
  prepared.mockImplementation(async (snapshot: { path: string; identity: string }) => {
    const dependencies = mkdtempSync(join(tmpdir(), "dg-mock-deps-")); roots.push(dependencies);
    return { path: dependencies, sourceIdentity: snapshot.identity, dependencyIdentity: "trusted-deps",
      verify() {}, cleanup() { rmSync(dependencies, { recursive: true, force: true }); } };
  });
  docker.mockResolvedValue({ status: "passed", exitCode: 0, stdout: tap, stderr: "", durationMs: 1 });
  verifier.mockImplementation(async (path: string, _before: CheckResult, checks: CheckResult[]) => {
    expect(path).toContain("deployguard-frozen-source-");
    expect(checks).toHaveLength(4);
    expect(checks.find((check) => check.id === "test"))
      .toMatchObject({ status: "passed", exitCode: 0, testExecutionVerified: true });
    return { status: "proven", summary: "Verified audit", comparisons: [], regressionChecks: checks };
  });
}

describe("trusted frozen lodash orchestration verification", () => {
  it("uses one frozen source for the attested regression, audit, and capability decision", async () => {
    arrange(); const root = fixture();
    const result = await verifyTrustedLodashRemediation(root, before, "lodash", "123", contract);
    expect(result.proof.status).toBe("proven");
    expect(result.sourceIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(verifier).toHaveBeenCalledOnce();
    expect(docker).toHaveBeenCalledOnce();
  });
  it("returns inconclusive for missing contract or changed test content", async () => {
    arrange(); const root = fixture();
    expect((await verifyTrustedLodashRemediation(root, before, "lodash", "123", null)).proof.status)
      .toBe("inconclusive");
    const changed = fixture("const test=require('node:test'); test('fake 1',()=>{}); test('fake 2',()=>{});");
    expect((await verifyTrustedLodashRemediation(changed, before, "lodash", "123", contract)).proof.status)
      .toBe("inconclusive");
    expect(verifier).not.toHaveBeenCalled();
  });
  it("returns inconclusive for incomplete test evidence and Docker failures", async () => {
    arrange(); const root = fixture();
    docker.mockResolvedValueOnce({ status: "passed", exitCode: 0,
      stdout: "TAP version 13\n1..2\n# tests 2\n# pass 2\n", stderr: "", durationMs: 1 });
    expect((await verifyTrustedLodashRemediation(root, before, "lodash", "123", contract)).proof.status)
      .toBe("inconclusive");
    docker.mockRejectedValueOnce(new Error("Docker unavailable"));
    expect((await verifyTrustedLodashRemediation(root, before, "lodash", "123", contract)).proof.status)
      .toBe("inconclusive");
    expect(verifier).not.toHaveBeenCalled();
  });
  it("cannot prove when post-remediation audit Docker state is unknown", async () => {
    arrange(); const root = fixture();
    verifier.mockRejectedValueOnce(new SandboxContainerStateUnknownError(
      "Post-remediation audit state unknown.", "deployguard-post-audit", "d".repeat(64)));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await verifyTrustedLodashRemediation(root, before, "lodash", "123", contract);
      expect(result.proof.status).toBe("inconclusive");
      const metadata = log.mock.calls.find(([label]) =>
        label === "[DeployGuard Frozen Verification] Docker state unknown; artifacts retained.")?.[1] as
        { recoveryId: string; containerId: string } | undefined;
      expect(metadata?.containerId).toBe("d".repeat(64));
      reconcile.mockRejectedValueOnce(new SandboxContainerStateUnknownError("Inspection failed."));
      await expect(reconcileRetainedArtifact(metadata!.recoveryId)).rejects.toThrow("Inspection failed.");
      reconcile.mockResolvedValueOnce(undefined);
      await reconcileRetainedArtifact(metadata!.recoveryId);
      expect(reconcile.mock.calls.at(-1)?.[0]).toMatchObject({ containerId: "d".repeat(64) });
    } finally { log.mockRestore(); }
  });
});
