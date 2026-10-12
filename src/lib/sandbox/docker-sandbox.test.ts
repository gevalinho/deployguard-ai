import { afterEach, describe, expect, it, vi } from "vitest";

const runCommand = vi.hoisted(() => vi.fn());
vi.mock("@/lib/execution/command-runner", () => ({ runCommand }));

import { runDockerSandboxCommand } from "./docker-sandbox";

afterEach(() => {
  vi.useRealTimers();
  runCommand.mockReset();
});

describe("Docker sandbox timeout", () => {
  it("provides a writable private tmpfs for nonroot npm cache writes", async () => {
    runCommand.mockResolvedValue({ status: "passed", exitCode: 0, stdout: "", stderr: "" });
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
      if (args[0] === "run") return execution;
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
  });

  it("does not report a safe timeout while the container is running", async () => {
    vi.useFakeTimers();
    let finishRun!: (result: object) => void;
    const execution = new Promise<object>((resolve) => { finishRun = resolve; });
    runCommand.mockImplementation((_command, args) => {
      if (args[0] === "run") return execution;
      if (args[0] === "inspect") return Promise.resolve({ exitCode: 0, stdout: "true", stderr: "", timedOut: false });
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "kill failed" });
    });
    const pending = runDockerSandboxCommand({
      repositoryPath: "/repo", command: ["npm"],
      limits: { memoryMb: 2048, cpus: 1, timeoutMs: 10 },
    });
    const rejection = expect(pending).rejects.toThrow("could not be confirmed stopped");
    await vi.advanceTimersByTimeAsync(10);
    finishRun({ status: "failed", exitCode: 1, stdout: "", stderr: "" });
    await rejection;
  });

  it("classifies Docker launch failure as infrastructure error", async () => {
    runCommand.mockResolvedValue({
      status: "failed",
      exitCode: 125,
      stdout: "",
      stderr: "Docker daemon unavailable",
      timedOut: false,
    });

    const result = await runDockerSandboxCommand({
      repositoryPath: "/repo",
      command: ["npm", "test"],
    });

    expect(result.status).toBe("infrastructure_error");
    expect(result.exitCode).toBe(125);
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

  it("propagates unexpected Docker execution exceptions", async () => {
    const error = new Error("Unexpected execution failure");

    runCommand.mockRejectedValue(error);

    await expect(
      runDockerSandboxCommand({
        repositoryPath: "/repo",
        command: ["npm", "test"],
      })
    ).rejects.toBe(error);
  });

  it("preserves ordinary repository command failures", async () => {
    runCommand.mockResolvedValue({
      status: "failed",
      exitCode: 1,
      stdout: "",
      stderr: "Tests failed",
      timedOut: false,
    });

    const result = await runDockerSandboxCommand({
      repositoryPath: "/repo",
      command: ["npm", "test"],
    });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
  });
});
