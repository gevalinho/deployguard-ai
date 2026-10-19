import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";
import { createFrozenSourceSnapshot } from "./frozen-source-snapshot";
import { prepareFrozenNpmDependencies, type PreparedFrozenDependencies } from "./frozen-dependency-preparation";
import { assertArtifactCanBeDeleted, FrozenArtifactContainerStateError,
  reconcileRetainedArtifact, retainUnknownArtifact, runWithArtifactOwnership } from "./frozen-artifact-ownership";
const docker = vi.hoisted(() => vi.fn());
const reconcile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sandbox/docker-sandbox")>(),
  runDockerSandboxCommand: docker, reconcileSandboxContainer: reconcile,
}));
import { runFrozenNodeRegression, type TrustedLodashProofContract } from "./frozen-regression-runner";

const cleanup: Array<() => void> = [];
const trustedTestSource = "const test = require('node:test'); for (let i=0;i<4;i++) test('case '+i,()=>{});";
const trustedContract: TrustedLodashProofContract = {
  fixture: "lodash-node22", expectedExecutedTests: 4, expectedPassingTests: 4,
  expectedTestNames: ["case 0", "case 1", "case 2", "case 3"],
  expectedTestFiles: [{ path: "test/lodash.test.js",
    sha256: createHash("sha256").update(trustedTestSource).digest("hex") }],
};
const tap = `TAP version 13
# Subtest: case 0
ok 1 - case 0
# Subtest: case 1
ok 2 - case 1
# Subtest: case 2
ok 3 - case 2
# Subtest: case 3
ok 4 - case 3
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
function fixture(script = "node --test", file: string | null = trustedTestSource, extra = false) {
  const root = mkdtempSync(join(tmpdir(), "deployguard-regression-unit-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", private: true,
    scripts: { test: script }, dependencies: { lodash: "4.17.21" } }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "fixture", version: "1.0.0",
    lockfileVersion: 3, packages: { "": { name: "fixture", version: "1.0.0",
      dependencies: { lodash: "4.17.21" } }, "node_modules/lodash": { version: "4.17.21",
      resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
      integrity: "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==" } } }));
  mkdirSync(join(root, "test"));
  if (file !== null) writeFileSync(join(root, "test", "lodash.test.js"), file);
  if (extra) writeFileSync(join(root, "test", "extra.test.js"), trustedTestSource);
  const snapshot = createFrozenSourceSnapshot(root); cleanup.push(() => snapshot.cleanup());
  return snapshot;
}
async function prepared(snapshot: ReturnType<typeof fixture>): Promise<PreparedFrozenDependencies> {
  docker.mockImplementationOnce(async ({ repositoryPath }: { repositoryPath: string }) => {
    const packageRoot = join(repositoryPath, "node_modules", "lodash");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "lodash", version: "4.17.21" }));
    writeFileSync(join(packageRoot, "index.js"), "module.exports = {};");
    return { status: "passed", exitCode: 0 };
  });
  const result = await prepareFrozenNpmDependencies(snapshot, snapshot.identity);
  cleanup.push(() => result.cleanup());
  return result;
}
afterEach(() => { docker.mockReset(); reconcile.mockReset(); for (const item of cleanup.splice(0).reverse()) item(); });

describe("isolated frozen Node regression runner", () => {
  it("runs only attested files with read-only source/dependencies and no network", async () => {
    const snapshot = fixture(); const deps = await prepared(snapshot);
    let scratch = "";
    docker.mockImplementationOnce(async (input: { repositoryPath: string; command: string[];
      network: string; mounts: Array<{ source: string; target: string; readOnly: boolean }> }) => {
      scratch = input.repositoryPath;
      expect(scratch).not.toBe(snapshot.path);
      expect(scratch).not.toBe(deps.path);
      expect(input.network).toBe("none");
      expect(input.command).toEqual(["node", "--test", "--test-reporter=tap", "/source/test/lodash.test.js"]);
      expect(input.mounts).toEqual([
        { source: snapshot.path, target: "/source", readOnly: true },
        { source: deps.path, target: "/deps", readOnly: true },
      ]);
      return { status: "passed", exitCode: 0, stdout: tap, stderr: "", durationMs: 1 };
    });
    const result = await runFrozenNodeRegression(snapshot, deps, trustedContract);
    expect(result).toMatchObject({ status: "passed", sourceIdentity: snapshot.identity,
      dependencyIdentity: deps.dependencyIdentity, testFiles: ["test/lodash.test.js"] });
    expect(existsSync(scratch)).toBe(false);
  });
  it("rejects a no-op script and absent attested test file", async () => {
    const noOp = fixture("true"); const deps = await prepared(noOp);
    expect((await runFrozenNodeRegression(noOp, deps, trustedContract)).status).toBe("inconclusive");
    const source = fixture(); const ready = await prepared(source);
    expect((await runFrozenNodeRegression(source, ready)).status).toBe("inconclusive");
    expect((await runFrozenNodeRegression(source, ready,
      { ...trustedContract, expectedTestFiles: [] })).status).toBe("inconclusive");
    expect((await runFrozenNodeRegression(source, ready,
      { ...trustedContract, expectedTestFiles: undefined } as unknown as TrustedLodashProofContract)).status)
      .toBe("inconclusive");
    expect((await runFrozenNodeRegression(source, ready,
      { ...trustedContract, expectedPassingTests: 3 } as unknown as TrustedLodashProofContract)).status)
      .toBe("inconclusive");
    expect((await runFrozenNodeRegression(source, ready,
      { ...trustedContract, expectedExecutedTests: 3 } as unknown as TrustedLodashProofContract)).status)
      .toBe("inconclusive");
    expect((await runFrozenNodeRegression(source, ready,
      { ...trustedContract, expectedTestNames: [] })).status).toBe("inconclusive");
    expect((await runFrozenNodeRegression(source, ready,
      { ...trustedContract, expectedTestNames: ["case 0", "case 0", "case 2", "case 3"] })).status)
      .toBe("inconclusive");
    expect(docker).toHaveBeenCalledTimes(2);
  });
  it("returns inconclusive for substituted, missing, extra, and hash-mismatched test files", async () => {
    for (const snapshot of [
      fixture("node --test", "const test=require('node:test'); test('substitute 1',()=>{}); test('substitute 2',()=>{});"),
      fixture("node --test", null),
      fixture("node --test", trustedTestSource, true),
    ]) {
      const deps = await prepared(snapshot);
      expect((await runFrozenNodeRegression(snapshot, deps, trustedContract)).status).toBe("inconclusive");
    }
    const source = fixture(); const deps = await prepared(source);
    const mismatch = { ...trustedContract, expectedTestFiles: [
      { path: "test/lodash.test.js", sha256: "0".repeat(64) }] };
    expect((await runFrozenNodeRegression(source, deps, mismatch)).status).toBe("inconclusive");
    expect(docker).toHaveBeenCalledTimes(4);
  });
  it("rejects a changed test file before execution", async () => {
    const snapshot = fixture(); const deps = await prepared(snapshot);
    const path = join(snapshot.path, "test", "lodash.test.js");
    chmodSync(path, 0o600); writeFileSync(path, "tampered");
    expect((await runFrozenNodeRegression(snapshot, deps, trustedContract)).status).toBe("inconclusive");
    expect(docker).toHaveBeenCalledTimes(1);
  });
  it("fails closed and cleans scratch if dependencies change during execution", async () => {
    const snapshot = fixture(); const deps = await prepared(snapshot);
    let scratch = "";
    docker.mockImplementationOnce(async ({ repositoryPath }: { repositoryPath: string }) => {
      scratch = repositoryPath;
      writeFileSync(join(deps.path, "lodash", "index.js"), "tampered");
      return { status: "passed", exitCode: 0, stdout: tap, stderr: "", durationMs: 1 };
    });
    expect((await runFrozenNodeRegression(snapshot, deps, trustedContract)).status).toBe("inconclusive");
    expect(existsSync(scratch)).toBe(false);
  });
  it("fails closed and cleans scratch if source changes during execution", async () => {
    const snapshot = fixture(); const deps = await prepared(snapshot);
    let scratch = "";
    docker.mockImplementationOnce(async ({ repositoryPath }: { repositoryPath: string }) => {
      scratch = repositoryPath;
      const file = join(snapshot.path, "test", "lodash.test.js");
      chmodSync(file, 0o600); writeFileSync(file, "tampered during test");
      return { status: "passed", exitCode: 0, stdout: tap, stderr: "", durationMs: 1 };
    });
    expect((await runFrozenNodeRegression(snapshot, deps, trustedContract)).status).toBe("inconclusive");
    expect(existsSync(scratch)).toBe(false);
  });
  it("does not report passing tests from a zero-test footer or missing exit code", async () => {
    const snapshot = fixture(); const deps = await prepared(snapshot);
    docker.mockResolvedValueOnce({ status: "passed", exitCode: 0,
      stdout: "TAP version 13\n1..0\n# tests 0\n# pass 0\n# fail 0\n", stderr: "", durationMs: 1 });
    expect((await runFrozenNodeRegression(snapshot, deps, trustedContract)).status).toBe("inconclusive");
    docker.mockResolvedValueOnce({ status: "passed", exitCode: null, stdout: tap, stderr: "", durationMs: 1 });
    expect((await runFrozenNodeRegression(snapshot, deps, trustedContract)).status).toBe("inconclusive");
  });
  it("rejects forged summaries, duplicate test events, and fewer than four passes", async () => {
    const snapshot = fixture(); const deps = await prepared(snapshot);
    for (const stdout of [
      "TAP version 13\n1..4\n# tests 4\n# suites 0\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n",
      tap.replace("ok 4 - case 3", "ok 3 - case 3"),
      tap.replace("# pass 4", "# pass 3"),
      tap.replace("# Subtest: case 2", "# Subtest: substituted case"),
      tap.replace("ok 3 - case 2", "ok 3 - substituted case"),
      tap.replace("ok 2 - case 1", "ok 2 - case 0"),
      tap.replace("# tests 4", "# tests 0\n# tests 4"),
    ]) {
      docker.mockResolvedValueOnce({ status: "passed", exitCode: 0, stdout, stderr: "", durationMs: 1 });
      expect((await runFrozenNodeRegression(snapshot, deps, trustedContract)).status).toBe("inconclusive");
    }
    docker.mockResolvedValueOnce({ status: "passed", exitCode: 0, stdout: tap, stderr: "", durationMs: 1 });
    expect((await runFrozenNodeRegression(snapshot, deps,
      { ...trustedContract, expectedTestNames: ["wrong 0", "wrong 1", "wrong 2", "wrong 3"] })).status)
      .toBe("inconclusive");
  });
  it("retains all mounts on unknown Docker state until inspection succeeds", async () => {
    const snapshot = fixture(); const deps = await prepared(snapshot);
    let scratch = "";
    docker.mockImplementationOnce(async ({ repositoryPath }: { repositoryPath: string }) => {
      scratch = repositoryPath;
      throw new SandboxContainerStateUnknownError("Inspection failed.",
        "deployguard-12345678-1234-1234-1234-123456789abc");
    });
    let ownership: FrozenArtifactContainerStateError | undefined;
    try { await runFrozenNodeRegression(snapshot, deps, trustedContract); }
    catch (error) { ownership = error as FrozenArtifactContainerStateError; }
    expect(ownership).toBeInstanceOf(FrozenArtifactContainerStateError);
    expect(ownership?.artifacts).toEqual([snapshot.path, deps.path, scratch]);
    expect(existsSync(scratch)).toBe(true);
    expect(() => snapshot.cleanup()).toThrow();
    expect(() => deps.cleanup()).toThrow();
    reconcile.mockRejectedValueOnce(new SandboxContainerStateUnknownError("Still unknown."));
    await expect(ownership!.reconcile()).rejects.toThrow("Still unknown.");
    expect(existsSync(scratch)).toBe(true);
    let finishInspection!: () => void;
    reconcile.mockImplementationOnce(() => new Promise<void>((resolve) => { finishInspection = resolve; }));
    const recovering = ownership!.reconcile();
    expect(() => snapshot.cleanup()).toThrow();
    expect(() => deps.cleanup()).toThrow();
    finishInspection();
    await recovering;
    expect(existsSync(scratch)).toBe(false);
    expect(() => deps.cleanup()).not.toThrow();
    expect(() => snapshot.cleanup()).not.toThrow();
  });
  it("retains npm staging and source after an unknown install container", async () => {
    const snapshot = fixture();
    docker.mockRejectedValueOnce(new SandboxContainerStateUnknownError("Install inspect failed.",
      "deployguard-12345678-1234-1234-1234-123456789abc"));
    let ownership: FrozenArtifactContainerStateError | undefined;
    try { await prepareFrozenNpmDependencies(snapshot, snapshot.identity); }
    catch (error) { ownership = error as FrozenArtifactContainerStateError; }
    expect(ownership).toBeInstanceOf(FrozenArtifactContainerStateError);
    expect(ownership?.artifacts).toHaveLength(2);
    expect(existsSync(ownership!.artifacts[1])).toBe(true);
    expect(() => snapshot.cleanup()).toThrow();
    reconcile.mockResolvedValueOnce(undefined);
    await ownership!.reconcile();
    expect(existsSync(ownership!.artifacts[1])).toBe(false);
    expect(() => snapshot.cleanup()).not.toThrow();
  });
  it("protects the integration probe's source, dependencies, and scratch on unknown state", async () => {
    const snapshot = fixture(); const deps = await prepared(snapshot);
    const scratch = mkdtempSync(join(tmpdir(), "deployguard-probe-unit-"));
    cleanup.push(() => rmSync(scratch, { recursive: true, force: true }));
    const original = new SandboxContainerStateUnknownError("Probe inspect failed.",
      "deployguard-12345678-1234-1234-1234-123456789abc", "a".repeat(64));
    const error = await runWithArtifactOwnership([snapshot.path, deps.path, scratch], scratch,
      async () => { throw original; }, () => rmSync(scratch, { recursive: true, force: true }))
      .catch((caught) => caught) as FrozenArtifactContainerStateError;
    expect(error).toBeInstanceOf(FrozenArtifactContainerStateError);
    expect(() => snapshot.cleanup()).toThrow();
    expect(() => deps.cleanup()).toThrow();
    expect(() => assertArtifactCanBeDeleted(scratch)).toThrow();
    reconcile.mockResolvedValueOnce(undefined);
    await error.reconcile();
    expect(existsSync(scratch)).toBe(false);
    expect(() => deps.cleanup()).not.toThrow();
    expect(() => snapshot.cleanup()).not.toThrow();
  });
  it("keeps a request's unknown mounts recoverable until reconciliation succeeds", async () => {
    const snapshot = fixture(); const deps = await prepared(snapshot);
    const original = new SandboxContainerStateUnknownError("Inspection failed.",
      "deployguard-12345678-1234-1234-1234-123456789abc", "a".repeat(64));
    const error = await runWithArtifactOwnership([snapshot.path, deps.path], snapshot.path,
      async () => { throw original; }, () => {})
      .catch((caught) => caught) as FrozenArtifactContainerStateError;
    const recoveryId = retainUnknownArtifact(error, () => { deps.cleanup(); snapshot.cleanup(); });
    reconcile.mockRejectedValueOnce(new SandboxContainerStateUnknownError("Still unknown."));
    await expect(reconcileRetainedArtifact(recoveryId)).rejects.toThrow("Still unknown.");
    expect(() => snapshot.cleanup()).toThrow();
    expect(() => deps.cleanup()).toThrow();
    reconcile.mockResolvedValueOnce(undefined);
    await reconcileRetainedArtifact(recoveryId);
    expect(() => snapshot.cleanup()).not.toThrow();
    expect(() => deps.cleanup()).not.toThrow();
    await expect(reconcileRetainedArtifact(recoveryId)).rejects.toThrow("Unknown artifact recovery identity.");
  });
});
