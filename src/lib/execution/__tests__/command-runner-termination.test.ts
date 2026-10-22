import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

import { CommandTerminationUnconfirmedError, runCommand } from "../command-runner";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); mocks.spawn.mockReset(); });

describe("bounded child termination", () => {
  function childWithoutClose() {
    const child = new EventEmitter() as EventEmitter & {
      pid: number; stdout: EventEmitter; stderr: EventEmitter;
    };
    child.pid = 54321;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    mocks.spawn.mockReturnValue(child);
    return child;
  }

  it("escalates from process-group SIGTERM to SIGKILL and reports unconfirmed exit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    childWithoutClose();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const pending = runCommand("git", ["status"], process.cwd(), { timeoutMs: 50 });
    const assertion = expect(pending).rejects.toBeInstanceOf(CommandTerminationUnconfirmedError);
    await vi.advanceTimersByTimeAsync(50);
    expect(kill).toHaveBeenCalledWith(-54321, "SIGTERM");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(kill).toHaveBeenCalledWith(-54321, "SIGKILL");
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it("accepts a real close event after escalation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const child = childWithoutClose();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const pending = runCommand("git", ["status"], process.cwd(), { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(2_050);
    expect(kill).toHaveBeenCalledWith(-54321, "SIGKILL");
    child.emit("close", null);
    await expect(pending).resolves.toMatchObject({ timedOut: true, status: "failed" });
  });
});
