import { afterEach, describe, expect, it, vi } from "vitest";

const runCommand = vi.hoisted(() => vi.fn());
vi.mock("@/lib/execution/command-runner", () => ({ runCommand }));

import { runDockerSandboxCommand } from "./docker-sandbox";

afterEach(() => {
  vi.useRealTimers();
  runCommand.mockReset();
});

describe("Docker sandbox timeout", () => {
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
});
