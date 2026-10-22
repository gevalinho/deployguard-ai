import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync,
  rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({
  workspace: "", cidFile: "", fullId: "", failInspectOnce: false,
  calls: [] as Array<{ operation: string; target?: string }>,
}));

// Fault injection and target restrictions exist only in this test module.
// Every permitted command still uses the production child-process runner.
vi.mock("@/lib/execution/command-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/execution/command-runner")>();
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  return { ...actual, runCommand: async (...args: Parameters<typeof actual.runCommand>) => {
    const [command, dockerArgs, cwd] = args;
    if (command !== "docker") return actual.runCommand(...args);
    const operation = dockerArgs[0];
    if (cwd !== guard.workspace) throw new Error("Docker command escaped the fixture workspace.");
    if (operation === "run") {
      if (guard.cidFile) throw new Error("Only one fixture container may run at a time.");
      const valueAfter = (flag: string) => dockerArgs[dockerArgs.indexOf(flag) + 1];
      const mounts = dockerArgs.flatMap((value, index) => value === "--mount"
        ? [dockerArgs[index + 1]] : []);
      const cidFile = valueAfter("--cidfile");
      const name = valueAfter("--name");
      if (!cidFile || !/^deployguard-container-id-[A-Za-z0-9]+$/.test(path.basename(path.dirname(cidFile))) ||
          path.dirname(path.dirname(cidFile)) !== os.tmpdir() ||
          !/^deployguard-[0-9a-f-]{36}$/.test(name ?? "") ||
          valueAfter("--network") !== "none" ||
          valueAfter("--user") !== `${process.getuid?.()}:${process.getgid?.()}` ||
          valueAfter("--memory") !== "256m" || valueAfter("--cpus") !== "0.5" ||
          mounts.length !== 1 || mounts[0] !== `type=bind,source=${guard.workspace},target=/workspace` ||
          dockerArgs.includes("--env") || dockerArgs.includes("--volume") ||
          dockerArgs.includes("--privileged") || valueAfter("--cap-drop") !== "ALL" ||
          valueAfter("--security-opt") !== "no-new-privileges" ||
          valueAfter("--pids-limit") !== "256" ||
          valueAfter("--tmpfs") !== "/tmp:rw,noexec,nosuid,size=256m,mode=1777" ||
          !dockerArgs.includes("--read-only") || !dockerArgs.includes("--rm") ||
          !dockerArgs.includes("node:22-bookworm-slim"))
        throw new Error("Docker run arguments violated fixture isolation.");
      const record = JSON.parse(fs.readFileSync(path.join(path.dirname(cidFile), "resources.json"), "utf8")) as {
        mountedPaths?: string[]; containerIdFile?: string;
      };
      if (record.containerIdFile !== cidFile ||
          JSON.stringify(record.mountedPaths) !== JSON.stringify([guard.workspace]))
        throw new Error("Docker ownership record includes another resource.");
      guard.cidFile = cidFile;
      guard.calls.push({ operation });
      return actual.runCommand(...args);
    }
    if (!guard.cidFile || !["kill", "rm", "inspect"].includes(operation))
      throw new Error("Unapproved Docker operation.");
    const id = fs.readFileSync(guard.cidFile, "utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(id) || (guard.fullId && guard.fullId !== id))
      throw new Error("Fixture container ID is missing or inconsistent.");
    guard.fullId = id;
    const target = dockerArgs.at(-1);
    if (target !== id) throw new Error("Docker operation did not target the fixture's full ID.");
    guard.calls.push({ operation, target });
    if (operation === "inspect" && guard.failInspectOnce) {
      guard.failInspectOnce = false;
      throw new Error("fixture_inspect_unavailable");
    }
    return actual.runCommand(...args);
  } };
});

import { createAssessmentExecutionContext, runAssessmentStage } from
  "@/lib/orchestration/assessment-execution";
import { runCommand } from "@/lib/execution/command-runner";
import { assertArtifactCanBeDeleted, FrozenArtifactContainerStateError,
  runWithArtifactOwnership } from "@/lib/remediation/frozen-artifact-ownership";
import { readRetainedSandboxResourceRecord, runDockerSandboxCommand } from "./docker-sandbox";

const enabled = process.env.DEPLOYGUARD_DOCKER_INTEGRATION === "1" &&
  Boolean(process.env.DG_TEST_DOCKER_HOST);
const dockerSuite = enabled ? describe : describe.skip;

function assertDedicatedDaemon(): void {
  const endpoint = process.env.DG_TEST_DOCKER_HOST;
  if (!endpoint || process.env.DOCKER_HOST !== endpoint || !endpoint.startsWith("unix:///") ||
      process.env.DOCKER_CONTEXT || process.env.DOCKER_TLS_VERIFY || process.env.DOCKER_CERT_PATH)
    throw new Error("A separately configured private Unix Docker endpoint is required.");
  const socket = endpoint.slice("unix://".length);
  const root = dirname(socket);
  if (dirname(root) !== resolve(tmpdir()) ||
      !/^deployguard-test-daemon-[A-Za-z0-9]+$/.test(basename(root)) ||
      basename(socket) !== "docker.sock")
    throw new Error("Docker endpoint is not in a dedicated test-daemon directory.");
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("The fixture requires a Unix user identity.");
  if (uid === 0) throw new Error("The integration fixture must run as an unprivileged user.");
  const rootStat = lstatSync(root);
  const socketStat = lstatSync(socket);
  const dataRoot = join(root, "data");
  const dataStat = lstatSync(dataRoot);
  const homeStat = lstatSync(join(root, "home"));
  const configStat = lstatSync(join(root, "config"));
  if (!rootStat.isDirectory() || rootStat.uid !== uid || (rootStat.mode & 0o077) !== 0 ||
      !socketStat.isSocket() || socketStat.uid !== uid ||
      !dataStat.isDirectory() || dataStat.uid !== uid || (dataStat.mode & 0o077) !== 0 ||
      !homeStat.isDirectory() || homeStat.uid !== uid || (homeStat.mode & 0o077) !== 0 ||
      !configStat.isDirectory() || configStat.uid !== uid || (configStat.mode & 0o077) !== 0 ||
      resolve(process.env.HOME ?? "") !== join(root, "home") ||
      resolve(process.env.DOCKER_CONFIG ?? "") !== join(root, "config"))
    throw new Error("Docker socket, data root, or client environment is not private.");
  const docker = (args: string[]) => execFileSync("docker", args,
    { encoding: "utf8", timeout: 10_000, env: process.env }).trim();
  const info = JSON.parse(docker(["info", "--format", "{{json .}}"])) as {
    DockerRootDir?: string; OperatingSystem?: string; SecurityOptions?: string[];
  };
  if (resolve(info.DockerRootDir ?? "") !== dataRoot ||
      /docker desktop/i.test(info.OperatingSystem ?? "") ||
      !info.SecurityOptions?.some((option) => option.includes("rootless")))
    throw new Error("The endpoint is not the dedicated rootless test daemon.");
  // Empty inventory is an additional check, never the isolation proof.
  if (docker(["ps", "--all", "--quiet"]))
    throw new Error("The dedicated test daemon already contains containers.");
  if (!docker(["image", "inspect", "node:22-bookworm-slim", "--format", "{{.Id}}"]))
    throw new Error("The fixed Node image must be preloaded.");
}

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "deployguard-sandbox-real-"));
  const fixture = join(path, "fixture.txt");
  writeFileSync(fixture, "fixture-owned\n");
  // Rootless UID mapping can differ from the host UID. This directory contains
  // only public fixture bytes, so allow the unprivileged container to read it.
  chmodSync(path, 0o755);
  chmodSync(fixture, 0o644);
  guard.workspace = path;
  guard.cidFile = "";
  guard.fullId = "";
  guard.failInspectOnce = false;
  guard.calls.length = 0;
  return path;
}

const input = (path: string, command: string[]) => ({
  repositoryPath: path, command, network: "none" as const,
  user: `${process.getuid?.()}:${process.getgid?.()}`,
  limits: { memoryMb: 256, cpus: 0.5, timeoutMs: 15_000 },
});

function assertExactIdReconciliation(): void {
  expect(guard.fullId).toMatch(/^[0-9a-f]{64}$/);
  expect(guard.calls.filter((call) => call.operation === "inspect").length).toBeGreaterThan(0);
  expect(guard.calls.filter((call) => call.target).every((call) => call.target === guard.fullId)).toBe(true);
}

dockerSuite("real Docker sandbox lifecycle on a dedicated daemon", () => {
  beforeAll(assertDedicatedDaemon, 45_000);

  it("runs a fixture and cleans only after exact-ID reconciliation", async () => {
    const path = workspace();
    let confirmed = false;
    try {
      const result = await runWithArtifactOwnership([path], path,
        () => runDockerSandboxCommand(input(path, ["node", "-e",
          "process.stdout.write(require('node:fs').readFileSync('/workspace/fixture.txt','utf8'))"])),
        () => rmSync(path, { recursive: true, force: true }));
      confirmed = true;
      expect(result).toMatchObject({ status: "passed", exitCode: 0 });
      expect(result.stdout).toBe("fixture-owned\n");
      assertExactIdReconciliation();
      expect(existsSync(guard.cidFile)).toBe(false);
    } finally {
      if (confirmed) {
        assertArtifactCanBeDeleted(path);
        rmSync(path, { recursive: true, force: true });
      } else console.error("Fixture workspace retained for reconciliation:", path, guard.cidFile);
    }
  }, 180_000);

  it("cancels only after the fixture container has started", async () => {
    const path = workspace();
    const context = createAssessmentExecutionContext();
    let confirmed = false;
    let pending: Promise<unknown> | undefined;
    try {
      pending = context.run(() => runAssessmentStage("test", () =>
        runWithArtifactOwnership([path], path,
          () => runDockerSandboxCommand(input(path, ["node", "-e",
            "setInterval(()=>{},1000)"])),
          () => rmSync(path, { recursive: true, force: true }))));
      const assertion = expect(pending).rejects.toMatchObject({ name: "AssessmentCancelledError" });
      await vi.waitFor(async () => {
        expect(guard.cidFile).not.toBe("");
        const id = readFileSync(guard.cidFile, "utf8").trim();
        const inspected = await runCommand("docker", ["inspect", "--format", "{{.State.Running}}", id],
          path, { timeoutMs: 2_000 });
        expect(inspected.exitCode).toBe(0);
        expect(inspected.stdout.trim()).toBe("true");
      }, { timeout: 10_000, interval: 2_500 });
      expect(context.cancel("user_requested")).toBe(true);
      await assertion;
      assertExactIdReconciliation();
      expect(guard.calls.some((call) => call.operation === "kill" && call.target === guard.fullId)).toBe(true);
      expect(existsSync(guard.cidFile)).toBe(false);
      confirmed = true;
    } finally {
      context.dispose();
      // If the running-state check failed, do not leave a launched command
      // running after the test case returns. Its own deadline still applies.
      if (!confirmed) await pending?.catch(() => undefined);
      if (confirmed) {
        assertArtifactCanBeDeleted(path);
        rmSync(path, { recursive: true, force: true });
      } else console.error("Cancelled fixture retained for reconciliation:", path, guard.cidFile);
    }
  }, 180_000);

  it("retains workspace and identity when one inspect fails, then reconciles the full ID", async () => {
    const path = workspace();
    guard.failInspectOnce = true;
    let reconciled = false;
    try {
      const error = await runWithArtifactOwnership([path], path,
        () => runDockerSandboxCommand(input(path, ["node", "-e", "process.stdout.write('done')"])),
        () => rmSync(path, { recursive: true, force: true }))
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(FrozenArtifactContainerStateError);
      const retained = error as FrozenArtifactContainerStateError;
      expect(existsSync(path)).toBe(true);
      expect(existsSync(guard.cidFile)).toBe(true);
      expect(() => assertArtifactCanBeDeleted(path)).toThrow();
      expect(readRetainedSandboxResourceRecord(dirname(guard.cidFile)).mountedPaths).toEqual([path]);
      assertExactIdReconciliation();
      await retained.reconcile();
      reconciled = true;
      expect(existsSync(path)).toBe(false);
      expect(existsSync(guard.cidFile)).toBe(false);
      expect(guard.calls.filter((call) => call.operation === "inspect")).toHaveLength(2);
    } finally {
      if (!reconciled) console.error("Unknown-state fixture retained for operator reconciliation:",
        path, guard.cidFile);
    }
  }, 180_000);
});
