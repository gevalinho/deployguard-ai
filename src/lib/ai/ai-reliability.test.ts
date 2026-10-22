import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAiJson } from "./response-validation";
import { validateArchitectureAnalysis } from "./architecture-validation";
import { runAiWithDeadline } from "./ai-deadline";
import { createAssessmentExecutionContext, runAssessmentStage } from
  "@/lib/orchestration/assessment-execution";

afterEach(() => vi.useRealTimers());

describe("bounded AI and strict JSON", () => {
  it("aborts a provider call that never settles within its deadline", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const outcome = runAiWithDeadline(100, async (requestSignal) => {
      signal = requestSignal;
      return new Promise<never>(() => {});
    });
    const assertion = expect(outcome).rejects.toThrow("AI request timed out.");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });

  it("settles promptly when an assessment is cancelled during optional AI", async () => {
    const context = createAssessmentExecutionContext();
    let providerSignal: AbortSignal | undefined;
    const pending = context.run(() => runAssessmentStage("optional", () =>
      runAiWithDeadline(60_000, async (signal) => {
        providerSignal = signal;
        return new Promise<never>(() => {});
      })));
    const assertion = expect(pending).rejects.toMatchObject({ name: "AssessmentCancelledError" });
    context.cancel("user_requested");
    await assertion;
    expect(providerSignal?.aborted).toBe(true);
    context.dispose();
  });

  it("propagates provider and network errors without retries", async () => {
    const operation = vi.fn(async () => { throw new Error("Provider unavailable"); });
    await expect(runAiWithDeadline(100, operation)).rejects.toThrow("Provider unavailable");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("accepts one fenced JSON object with prose but retains schema validation", () => {
    const valid = { summary: "Evidence", architectureType: "web", recommendedChecks: [], risks: [] };
    expect(validateArchitectureAnalysis(parseAiJson(`Analysis follows.\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\nDone.`))).toEqual(valid);
    expect(() => validateArchitectureAnalysis(parseAiJson("```json\n{}\n```"))).toThrow("invalid summary");
    expect(() => parseAiJson("The result is {not JSON}.")).toThrow("valid JSON");
    expect(() => parseAiJson("```json\n{}\n```\n```json\n{}\n``` ")).toThrow("valid JSON");
  });
});
