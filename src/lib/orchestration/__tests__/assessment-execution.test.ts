import { afterEach, describe, expect, it, vi } from "vitest";
import { assessmentDelay, currentAssessmentExecution, remainingAssessmentMs,
  runAssessmentExecution, runAssessmentStage, createAssessmentExecutionContext } from "../assessment-execution";

afterEach(() => vi.useRealTimers());

describe("assessment execution budgets", () => {
  it("shares one stage allowance across retries", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const pending = runAssessmentExecution(async () => {
      await runAssessmentStage("authorization", () => assessmentDelay(30_000));
      return runAssessmentStage("authorization", () => assessmentDelay(20_000));
    });
    const assertion = expect(pending).rejects.toMatchObject({
      stage: "authorization", reason: "stage_deadline_exceeded",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(15_100);
    await assertion;
  });

  it("uses the remaining overall allowance when it is shorter than a stage", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const pending = runAssessmentExecution(async () => {
      await assessmentDelay(29 * 60_000 + 30_000);
      return runAssessmentStage("scan", () => assessmentDelay(45_000));
    });
    const assertion = expect(pending).rejects.toMatchObject({
      stage: "overall", reason: "assessment_deadline_exceeded",
    });
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 100);
    await assertion;
  });

  it("exposes safe stage metadata and a deadline signal", async () => {
    await runAssessmentExecution(() => runAssessmentStage("report", async () => {
      expect(currentAssessmentExecution()?.stage).toBe("report");
      expect(currentAssessmentExecution()?.signal.aborted).toBe(false);
      expect(remainingAssessmentMs()).toBeLessThanOrEqual(30_000);
    }));
  });

  it("preserves unknown Docker state when reconciliation finishes after the stage deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const unknownState = Object.assign(new Error("Docker identity must be retained"), {
      name: "SandboxContainerStateUnknownError",
    });
    const pending = runAssessmentExecution(() => runAssessmentStage("scan", async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 46_000));
      throw unknownState;
    }));
    const assertion = expect(pending).rejects.toBe(unknownState);
    await vi.advanceTimersByTimeAsync(46_000);
    await assertion;
  });

  it("can continue to reporting after the shared optional budget expires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const pending = runAssessmentExecution(async () => {
      await expect(runAssessmentStage("optional", () => assessmentDelay(180_001)))
        .rejects.toMatchObject({ reason: "stage_deadline_exceeded" });
      return runAssessmentStage("report", async () => "deterministic-report");
    });
    await vi.advanceTimersByTimeAsync(180_100);
    await expect(pending).resolves.toBe("deterministic-report");
  });

  it("cancels retry delays idempotently and schedules no later stage", async () => {
    const context = createAssessmentExecutionContext();
    let laterStageRan = false;
    const pending = context.run(async () => {
      await runAssessmentStage("preparation", () => assessmentDelay(60_000));
      laterStageRan = true;
    });
    expect(context.cancel("user_requested")).toBe(true);
    expect(context.cancel("client_disconnect")).toBe(false);
    await expect(pending).rejects.toMatchObject({ name: "AssessmentCancelledError",
      reason: "user_requested" });
    expect(laterStageRan).toBe(false);
    context.dispose();
  });

  it("does not replace unresolved Docker ownership with cancellation", async () => {
    const context = createAssessmentExecutionContext();
    const unknownState = Object.assign(new Error("retain mounts"), {
      name: "SandboxContainerStateUnknownError",
    });
    const pending = context.run(() => runAssessmentStage("build", async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      throw unknownState;
    }));
    context.cancel("user_requested");
    await expect(pending).rejects.toBe(unknownState);
    context.dispose();
  });

  it("cancels optional work and blocks later report generation", async () => {
    const context = createAssessmentExecutionContext();
    let reportRan = false;
    const pending = context.run(async () => {
      await runAssessmentStage("optional", () => assessmentDelay(60_000));
      await runAssessmentStage("report", async () => { reportRan = true; });
    });
    context.cancel("user_requested");
    await expect(pending).rejects.toMatchObject({ name: "AssessmentCancelledError" });
    expect(reportRan).toBe(false);
    context.dispose();
  });

  it("prevents a report assembled after cancellation from completing", async () => {
    const context = createAssessmentExecutionContext();
    let finish!: () => void;
    const pending = context.run(() => runAssessmentStage("report", () =>
      new Promise<void>((resolve) => { finish = resolve; })));
    context.cancel("user_requested");
    finish();
    await expect(pending).rejects.toMatchObject({ name: "AssessmentCancelledError" });
    context.dispose();
  });
});
