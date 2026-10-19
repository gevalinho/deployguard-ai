import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";

const runCommand = vi.hoisted(() => vi.fn());
vi.mock("@/lib/execution/command-runner", () => ({ runCommand }));

import { discardSandboxContainerIdentity, reconcileSandboxContainer, runDockerSandboxCommand,
  SandboxContainerStateUnknownError } from "./docker-sandbox";

const containerId = "a".repeat(64);
function recordId(args: string[]): void {
  writeFileSync(args[args.indexOf("--cidfile") + 1], `${containerId}\n`);
}

afterEach(() => {
  vi.useRealTimers();
  runCommand.mockReset();
});

describe("Docker sandbox timeout", () => {
  it("provides a writable private tmpfs for nonroot npm cache writes", async () => {
    runCommand.mockImplementation((_command, args) => {
      if (args[0] === "run") recordId(args);
      if (args[0] === "inspect") return Promise.resolve({ exitCode: 1, stderr: "No such object" });
      return Promise.resolve({ status: "passed", exitCode: 0, stdout: "", stderr: "" });
    });
    await runDockerSandboxCommand({
      repositoryPath: "/repo", command: ["npm", "audit", "fix"],
      user: "1000:1000", environment: { npm_config_cache: "/tmp/npm-cache" },
    });
    const args = runCommand.mock.calls[0][1] as string[];
    expect(args.slice(args.indexOf("--tmpfs"), args.indexOf("--tmpfs") + 2))
      .toEqual(["--tmpfs", "/tmp:rw,noexec,nosuid,size=256m,mode=1777"]);
    expect(args).toContain("--read-only");
    expect(args).toContain("no-new-privileges");
    expect(args.slice(args.indexOf("--user"), args.indexOf("--user") + 2))
      .toEqual(["--user", "1000:1000"]);
    expect(args).not.toContain("--volume");
  });

  it("waits for docker run to exit before reporting timeout", async () => {
    vi.useFakeTimers();
    let finishRun!: (result: object) => void;
    const execution = new Promise<object>((resolve) => { finishRun = resolve; });
    runCommand.mockImplementation((_command, args) => {
      if (args[0] === "run") { recordId(args); return execution; }
      if (args[0] === "inspect") return Promise.resolve({
        status: "failed", exitCode: 1, stdout: "", stderr: "Error: No such object: deployguard-test",
      });
      return Promise.resolve({ status: "passed", exitCode: 0, stdout: "", stderr: "" });
    });

    let settled = false;
    const pending = runDockerSandboxCommand({
      repositoryPath: "/repo",
      command: ["npm", "audit", "fix"],
      limits: { memoryMb: 2048, cpus: 1, timeoutMs: 10 },
    }).then((result) => { settled = true; return result; });

    await vi.advanceTimersByTimeAsync(10);
    expect(runCommand.mock.calls.some(([, args]) => args[0] === "kill")).toBe(true);
    expect(settled).toBe(false);
    finishRun({ status: "failed", exitCode: 137, stdout: "", stderr: "" });
    expect((await pending).status).toBe("timed_out");
    expect(runCommand.mock.calls.map(([, args]) => args[0])).toEqual(["run", "kill", "inspect"]);
    expect(runCommand.mock.calls[2][1][3]).toBe(containerId);
  });

  it("does not report a safe timeout while the container is running", async () => {
    vi.useFakeTimers();
    let finishRun!: (result: object) => void;
    const execution = new Promise<object>((resolve) => { finishRun = resolve; });
    runCommand.mockImplementation((_command, args) => {
      if (args[0] === "run") { recordId(args); return execution; }
      if (args[0] === "inspect") return Promise.resolve({ exitCode: 0, stdout: "true", stderr: "", timedOut: false });
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "kill failed" });
    });
    const pending = runDockerSandboxCommand({
      repositoryPath: "/repo", command: ["npm"],
      limits: { memoryMb: 2048, cpus: 1, timeoutMs: 10 },
    });
    const rejection = expect(pending).rejects.toThrow("is not confirmed stopped");
    await vi.advanceTimersByTimeAsync(10);
    finishRun({ status: "failed", exitCode: 1, stdout: "", stderr: "" });
    await rejection;
  });

  it("retains ownership when Docker launch fails before its ID is established", async () => {
    runCommand.mockResolvedValue({
      status: "failed",
      exitCode: 125,
      stdout: "",
      stderr: "Docker daemon unavailable",
      timedOut: false,
    });

    await expect(runDockerSandboxCommand({
      repositoryPath: "/repo",
      command: ["npm", "test"],
    })).rejects.toBeInstanceOf(SandboxContainerStateUnknownError);
  });

  it("treats an abnormal Docker client exit with a running container as unknown", async () => {
    runCommand.mockImplementation((_command, args) => {
      if (args[0] === "run") {
        recordId(args);
        return Promise.resolve({ status: "failed", exitCode: null, stdout: "", stderr: "client killed" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "true", stderr: "", timedOut: false });
    });
    const error = await runDockerSandboxCommand({ repositoryPath: "/repo", command: ["node"] })
      .catch((caught) => caught) as SandboxContainerStateUnknownError;
    expect(error).toBeInstanceOf(SandboxContainerStateUnknownError);
    expect(error.containerId).toBe(containerId);
    expect(runCommand.mock.calls[1][1]).toEqual(["inspect", "--format", "{{.State.Running}}", containerId]);
  });

  it("keeps inspection errors unknown after an abnormal client exit", async () => {
    runCommand.mockImplementation((_command, args) => {
      if (args[0] === "run") { recordId(args); return Promise.resolve({ status: "failed", exitCode: 125 }); }
      return Promise.reject(new Error("daemon unavailable"));
    });
    await expect(runDockerSandboxCommand({ repositoryPath: "/repo", command: ["node"] }))
      .rejects.toBeInstanceOf(SandboxContainerStateUnknownError);
  });

  it("reconciles the original ID even if its name is renamed and reused", async () => {
    const original = new SandboxContainerStateUnknownError("unknown",
      "deployguard-12345678-1234-1234-1234-123456789abc", containerId);
    runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "true", stderr: "", timedOut: false });
    await expect(reconcileSandboxContainer(original, "/repo"))
      .rejects.toBeInstanceOf(SandboxContainerStateUnknownError);
    expect(runCommand.mock.calls[0][1][3]).toBe(containerId);
    // A stopped replacement under the original name does not change this result.
    runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "false", stderr: "", timedOut: false });
    await expect(reconcileSandboxContainer(original, "/repo")).resolves.toBeUndefined();
    expect(runCommand.mock.calls[1][1][3]).toBe(containerId);
  });

  it("cannot reconcile by name when the original full ID is unavailable", async () => {
    const original = new SandboxContainerStateUnknownError("unknown",
      "deployguard-12345678-1234-1234-1234-123456789abc");
    await expect(reconcileSandboxContainer(original, "/repo"))
      .rejects.toThrow("ID is unavailable");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("does not terminate by a reusable name when timeout occurs before CID capture", async () => {
    vi.useFakeTimers();
    runCommand.mockImplementation((_command, args) => {
      if (args[0] === "run") return new Promise(() => {});
      throw new Error("A name-based Docker operation must not run.");
    });
    const pending = runDockerSandboxCommand({ repositoryPath: "/repo", command: ["node"],
      limits: { memoryMb: 2048, cpus: 1, timeoutMs: 10 } });
    const settled = pending.catch((caught) => caught as SandboxContainerStateUnknownError);
    await vi.advanceTimersByTimeAsync(10);
    const error = await settled as SandboxContainerStateUnknownError;
    expect(error).toBeInstanceOf(SandboxContainerStateUnknownError);
    expect(error.containerId).toBeUndefined();
    expect(runCommand).toHaveBeenCalledTimes(1);
    writeFileSync(error.containerIdFile!, `${containerId}\n`);
    runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "false", stderr: "", timedOut: false });
    await expect(reconcileSandboxContainer(error, "/repo")).resolves.toBeUndefined();
    expect(runCommand.mock.calls[1][1][3]).toBe(containerId);
    discardSandboxContainerIdentity(error);
  });

  it.each(["ENOENT", "EACCES", "EPERM"])(
    "classifies Docker process-start error %s as infrastructure failure",
    async (code) => {
      const error = Object.assign(
        new Error("Sensitive Docker startup diagnostic"),
        { code }
      );

      runCommand.mockRejectedValue(error);

      const result = await runDockerSandboxCommand({
        repositoryPath: "/repo",
        command: ["npm", "test"],
      });

      expect(result.status).toBe("infrastructure_error");
      expect(result.exitCode).toBeNull();
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  );

  it("preserves ownership when Docker execution throws unexpectedly", async () => {
    const error = new Error("Unexpected execution failure");

    runCommand.mockRejectedValue(error);

    await expect(
      runDockerSandboxCommand({
        repositoryPath: "/repo",
        command: ["npm", "test"],
      })
    ).rejects.toBeInstanceOf(SandboxContainerStateUnknownError);
  });

  it("keeps a timeout inspection failure observable until reconciliation confirms stopped", async () => {
    vi.useFakeTimers();
    // A finished Docker client can still leave the container state unknown when inspect fails.
    let finishRun!: (result: object) => void;
    runCommand.mockImplementation((_command, args) => {
      if (args[0] === "run") { recordId(args); return new Promise<object>((resolve) => { finishRun = resolve; }); }
      if (args[0] === "inspect") return Promise.reject(new Error("daemon unavailable"));
      return Promise.resolve({ status: "passed", exitCode: 0, stdout: "", stderr: "" });
    });
    const pending = runDockerSandboxCommand({ repositoryPath: "/repo", command: ["node"],
      limits: { memoryMb: 2048, cpus: 1, timeoutMs: 10 } });
    await vi.advanceTimersByTimeAsync(10);
    finishRun({ status: "failed", exitCode: 137, stdout: "", stderr: "" });
    const error = await pending.catch((caught) => caught) as SandboxContainerStateUnknownError;
    expect(error).toBeInstanceOf(SandboxContainerStateUnknownError);
    expect(error.containerName).toMatch(/^deployguard-/);
    await expect(reconcileSandboxContainer(error, "/repo"))
      .rejects.toBeInstanceOf(SandboxContainerStateUnknownError);
    runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "false", stderr: "", timedOut: false });
    await expect(reconcileSandboxContainer(error, "/repo")).resolves.toBeUndefined();
  });

  it("preserves ordinary repository command failures", async () => {
    runCommand.mockImplementation((_command, args) => {
      if (args[0] === "run") recordId(args);
      if (args[0] === "inspect") return Promise.resolve({ exitCode: 1, stderr: "No such object" });
      return Promise.resolve({
      status: "failed",
      exitCode: 1,
      stdout: "",
      stderr: "Tests failed",
      timedOut: false,
      });
    });

    const result = await runDockerSandboxCommand({
      repositoryPath: "/repo",
      command: ["npm", "test"],
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
  });
});
