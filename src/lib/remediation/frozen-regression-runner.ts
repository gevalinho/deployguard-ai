/** Isolated Node 22 regression execution for a frozen npm dependency fixture.
 * Docker's writable /workspace bind is a private, empty scratch directory.
 * Source and dependencies are separate read-only mounts. Host-side writers can
 * still race a bind mount; identity checks before and after do not make capture
 * atomic, so callers must also protect the private trees against host writes.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync,
  readFileSync, readdirSync, rmSync, type BigIntStats } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runDockerSandboxCommand, SandboxContainerStateUnknownError,
  type DockerSandboxCommandResult } from "@/lib/sandbox/docker-sandbox";
import type { FrozenSourceSnapshot } from "./frozen-source-snapshot";
import type { PreparedFrozenDependencies } from "./frozen-dependency-preparation";
import { FrozenArtifactContainerStateError, holdArtifacts } from "./frozen-artifact-ownership";

export class FrozenRegressionRunnerError extends Error {
  constructor(message: string) { super(message); this.name = "FrozenRegressionRunnerError"; }
}
/** Supplied by a trusted caller, never derived from the repository under test. */
export interface TrustedLodashProofContract {
  readonly fixture: "lodash-node22";
  readonly expectedTestFiles: readonly { readonly path: string; readonly sha256: string }[];
  readonly expectedExecutedTests: 4;
  readonly expectedPassingTests: 4;
  /** Exact Node test names, in execution order, from the trusted fixture. */
  readonly expectedTestNames: readonly string[];
}
export interface FrozenNodeRegressionResult {
  readonly status: "passed" | "failed" | "inconclusive";
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly sourceIdentity: string;
  readonly dependencyIdentity: string;
  readonly testFiles: readonly string[];
}
function fail(message: string): never { throw new FrozenRegressionRunnerError(message); }
function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.size === right.size && left.nlink === right.nlink &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function fileDigest(path: string): string {
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.nlink !== BigInt(1) || before.size > BigInt(128 * 1024 * 1024))
    fail("Unsafe attested Node test file.");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!sameFile(before, fstatSync(fd, { bigint: true }))) fail("Node test file changed before reading.");
    const content = readFileSync(fd);
    if (BigInt(content.length) !== before.size ||
        !sameFile(before, fstatSync(fd, { bigint: true })) ||
        !sameFile(before, lstatSync(path, { bigint: true })))
      fail("Node test file changed while reading.");
    return createHash("sha256").update(content).digest("hex");
  } finally { closeSync(fd); }
}
function discover(snapshot: FrozenSourceSnapshot): { path: string; sha256: string }[] {
  const directory = join(snapshot.path, "test");
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Node test directory is unsafe.");
  const names = readdirSync(directory).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (!names.length || names.length > 32 || names.some((name) =>
    !/^[A-Za-z0-9_.-]+\.test\.(?:js|cjs|mjs)$/.test(name)))
    fail("Unsupported or missing Node test files.");
  const files = names.map((name) => ({ path: `test/${name}`, sha256: fileDigest(join(directory, name)) }));
  const afterNames = readdirSync(directory).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (names.length !== afterNames.length || names.some((name, index) => name !== afterNames[index]) ||
      !sameFile(stat, lstatSync(directory, { bigint: true })))
    fail("Node test directory changed during attestation.");
  return files;
}
function contractFiles(snapshot: FrozenSourceSnapshot,
  contract: TrustedLodashProofContract | undefined): string[] | null {
  if (contract?.fixture !== "lodash-node22" || contract.expectedExecutedTests !== 4 ||
      contract.expectedPassingTests !== 4 ||
      !Array.isArray(contract.expectedTestNames) || contract.expectedTestNames.length !== 4 ||
      contract.expectedTestNames.some((name) => typeof name !== "string" ||
        !/^[A-Za-z0-9 _.-]{1,100}$/.test(name)) ||
      new Set(contract.expectedTestNames).size !== 4 ||
      !Array.isArray(contract.expectedTestFiles) || contract.expectedTestFiles.length !== 1 ||
      contract.expectedTestFiles[0]?.path !== "test/lodash.test.js" ||
      typeof contract.expectedTestFiles[0]?.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(contract.expectedTestFiles[0].sha256)) return null;
  try {
    const manifest = JSON.parse(readFileSync(join(snapshot.path, "package.json"), "utf8")) as
      { scripts?: { test?: unknown } };
    if (manifest.scripts?.test !== "node --test") return null;
    const actual = discover(snapshot);
    if (actual.length !== 1 || actual[0].path !== contract.expectedTestFiles[0].path ||
        actual[0].sha256 !== contract.expectedTestFiles[0].sha256) return null;
    return actual.map((file) => file.path);
  } catch { return null; }
}
function hasFourPassingNodeTests(stdout: string, expectedNames: readonly string[]): boolean {
  const footer = /(?:^|\n)1\.\.4\n# tests 4\n# suites 0\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms [\d.]+\n?$/.exec(stdout);
  if (!stdout.startsWith("TAP version 13\n") || !footer || /(?:^|\n)not ok\b/.test(stdout)) return false;
  const lines = stdout.split("\n");
  const summaryLines = lines.filter((line) =>
    /^# (?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(line));
  if (summaryLines.length !== 8 || lines.filter((line) => /^1\.\./.test(line)).length !== 1)
    return false;
  const events = lines.filter((line) => line.startsWith("# Subtest: ") ||
    /^(?:not )?ok\b/.test(line));
  return events.length === 8 && expectedNames.every((name, index) =>
    events[index * 2] === `# Subtest: ${name}` &&
    events[index * 2 + 1] === `ok ${index + 1} - ${name}`);
}
function inconclusive(snapshot: FrozenSourceSnapshot, prepared: PreparedFrozenDependencies,
  result?: { exitCode: number | null; stdout: string; stderr: string; durationMs: number }): FrozenNodeRegressionResult {
  return { status: "inconclusive", exitCode: result?.exitCode ?? null,
    stdout: result?.stdout ?? "", stderr: result?.stderr ?? "", durationMs: result?.durationMs ?? 0,
    sourceIdentity: snapshot.identity, dependencyIdentity: prepared.dependencyIdentity, testFiles: [] };
}
export async function runFrozenNodeRegression(snapshot: FrozenSourceSnapshot,
  prepared: PreparedFrozenDependencies, contract?: TrustedLodashProofContract): Promise<FrozenNodeRegressionResult> {
  if (prepared.sourceIdentity !== snapshot.identity) return inconclusive(snapshot, prepared);
  const files = contractFiles(snapshot, contract);
  if (!files || !contract) return inconclusive(snapshot, prepared);
  // Capture the trusted caller's values before yielding to Docker execution.
  const trustedContract: TrustedLodashProofContract = {
    fixture: "lodash-node22", expectedExecutedTests: 4, expectedPassingTests: 4,
    expectedTestFiles: contract.expectedTestFiles.map((file) => ({ path: file.path, sha256: file.sha256 })),
    expectedTestNames: [...contract.expectedTestNames],
  };
  try { prepared.verify(); } catch { return inconclusive(snapshot, prepared); }
  const scratch = mkdtempSync(join(tmpdir(), "deployguard-frozen-regression-"));
  const release = holdArtifacts([snapshot.path, prepared.path, scratch]);
  let result: DockerSandboxCommandResult | undefined;
  let runError: unknown;
  let ownedError: FrozenArtifactContainerStateError | undefined;
  let postValid = false;
  try {
    result = await runDockerSandboxCommand({
      repositoryPath: scratch,
      command: ["node", "--test", "--test-reporter=tap", ...files.map((file) => `/source/${file}`)],
      network: "none",
      user: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      environment: { CI: "true", HOME: "/tmp", NODE_PATH: "/deps" },
      mounts: [
        { source: resolve(snapshot.path), target: "/source", readOnly: true },
        { source: resolve(prepared.path), target: "/deps", readOnly: true },
      ],
      limits: { memoryMb: 2048, cpus: 1, timeoutMs: 5 * 60 * 1000 },
    });
  } catch (error) {
    if (error instanceof SandboxContainerStateUnknownError)
      ownedError = new FrozenArtifactContainerStateError(error,
        [snapshot.path, prepared.path, scratch], scratch,
        () => { release(); rmSync(scratch, { recursive: true, force: true }); });
    else runError = error;
  } finally {
    try { prepared.verify(); postValid = contractFiles(snapshot, trustedContract) !== null; }
    catch { postValid = false; }
    if (!ownedError) { release(); rmSync(scratch, { recursive: true, force: true }); }
  }
  if (ownedError) throw ownedError;
  if (!postValid) return inconclusive(snapshot, prepared, result);
  if (runError) throw runError;
  if (!result) return inconclusive(snapshot, prepared);
  const status = result.status === "passed" && result.exitCode === 0
    ? hasFourPassingNodeTests(result.stdout, trustedContract.expectedTestNames) ? "passed" : "inconclusive"
    : result.status === "failed" && result.exitCode !== null && result.exitCode !== 0
      ? "failed" : "inconclusive";
  return { status, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
    durationMs: result.durationMs, sourceIdentity: snapshot.identity,
    dependencyIdentity: prepared.dependencyIdentity, testFiles: files };
}
