import { AsyncLocalStorage } from "node:async_hooks";

export type AssessmentStage = "authorization" | "repository" | "scan" | "preparation" |
  "types" | "lint" | "test" | "build" | "security" | "optional" | "report";

export const ASSESSMENT_BUDGET_MS = {
  authorization: 45_000, repository: 420_000, scan: 45_000,
  preparation: 480_000, types: 240_000, lint: 240_000,
  test: 300_000, build: 360_000, security: 120_000,
  optional: 180_000, report: 30_000,
  overall: 1_800_000, cleanup: 120_000,
} as const;

interface ExecutionState {
  overallDeadline: number;
  stageDeadlines: Map<AssessmentStage, number>;
  stage?: AssessmentStage;
  stageDeadline?: number;
  signal: AbortSignal;
}

const execution = new AsyncLocalStorage<ExecutionState>();

export class AssessmentDeadlineError extends Error {
  constructor(readonly stage: AssessmentStage | "overall", readonly reason:
    "assessment_deadline_exceeded" | "stage_deadline_exceeded") {
    super(reason);
    this.name = "AssessmentDeadlineError";
  }
}

export type AssessmentCancellationReason = "user_requested" | "client_disconnect";
export class AssessmentCancelledError extends Error {
  constructor(readonly reason: AssessmentCancellationReason) {
    super(reason);
    this.name = "AssessmentCancelledError";
  }
}

function cancellationError(state: ExecutionState): AssessmentCancelledError | undefined {
  return state.signal.aborted && (state.signal.reason === "user_requested" ||
    state.signal.reason === "client_disconnect")
    ? new AssessmentCancelledError(state.signal.reason) : undefined;
}

export function currentAssessmentExecution(): ExecutionState | undefined {
  return execution.getStore();
}

export function remainingAssessmentMs(cap = Number.POSITIVE_INFINITY): number {
  const state = execution.getStore();
  if (!state) return cap;
  const cancelled = cancellationError(state);
  if (cancelled) throw cancelled;
  const now = performance.now();
  const overall = state.overallDeadline - now;
  if (overall <= 0) throw new AssessmentDeadlineError("overall", "assessment_deadline_exceeded");
  const stage = (state.stageDeadline ?? Number.POSITIVE_INFINITY) - now;
  if (stage <= 0) throw new AssessmentDeadlineError(state.stage ?? "overall", "stage_deadline_exceeded");
  return Math.max(1, Math.ceil(Math.min(cap, overall, stage)));
}

export function assertAssessmentTime(): void { remainingAssessmentMs(); }

export async function runAssessmentExecution<T>(work: () => Promise<T>): Promise<T> {
  const context = createAssessmentExecutionContext();
  try { return await context.run(work); }
  finally { context.dispose(); }
}

export function createAssessmentExecutionContext(): {
  run<T>(work: () => Promise<T>): Promise<T>;
  cancel(reason: AssessmentCancellationReason): boolean;
  readonly signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const state: ExecutionState = {
    overallDeadline: performance.now() + ASSESSMENT_BUDGET_MS.overall,
    stageDeadlines: new Map(),
    signal: controller.signal,
  };
  const timer = setTimeout(() => controller.abort("assessment_deadline_exceeded"),
    ASSESSMENT_BUDGET_MS.overall);
  return { run: (work) => execution.run(state, work),
    cancel: (reason) => { if (controller.signal.aborted) return false; controller.abort(reason); return true; },
    signal: controller.signal, dispose: () => clearTimeout(timer) };
}

export async function runAssessmentStage<T>(stage: AssessmentStage,
  work: () => Promise<T>): Promise<T> {
  const parent = execution.getStore();
  if (!parent) return work();
  let stageDeadline = parent.stageDeadlines.get(stage);
  if (stageDeadline === undefined) {
    stageDeadline = performance.now() + ASSESSMENT_BUDGET_MS[stage];
    parent.stageDeadlines.set(stage, stageDeadline);
  }
  const deadline = Math.min(parent.overallDeadline, stageDeadline);
  const controller = new AbortController();
  const abort = () => controller.abort(parent.signal.reason);
  if (parent.signal.aborted) abort();
  else parent.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(
    deadline === parent.overallDeadline ? "assessment_deadline_exceeded" : "stage_deadline_exceeded"),
    Math.max(1, deadline - performance.now()));
  try {
    return await execution.run({ overallDeadline: parent.overallDeadline,
      stageDeadlines: parent.stageDeadlines,
      stage, stageDeadline: deadline, signal: controller.signal }, async () => {
      assertAssessmentTime();
      let result: T;
      try { result = await work(); }
      catch (error) {
        // Docker reconciliation owns these errors. Replacing one with a deadline
        // would let orchestration delete bind sources whose container may still run.
        if (error instanceof Error && (error.name === "SandboxContainerStateUnknownError" ||
            error.name === "FrozenArtifactContainerStateError" ||
            error.name === "CommandTerminationUnconfirmedError")) throw error;
        if (controller.signal.aborted) {
          if (controller.signal.reason === "user_requested" || controller.signal.reason === "client_disconnect")
            throw new AssessmentCancelledError(controller.signal.reason);
          if (controller.signal.reason === "assessment_deadline_exceeded" ||
              performance.now() >= parent.overallDeadline)
            throw new AssessmentDeadlineError("overall", "assessment_deadline_exceeded");
          throw new AssessmentDeadlineError(stage, "stage_deadline_exceeded");
        }
        throw error;
      }
      assertAssessmentTime();
      return result;
    });
  } finally {
    clearTimeout(timer);
    parent.signal.removeEventListener("abort", abort);
  }
}

export async function assessmentDelay(ms: number): Promise<void> {
  const bounded = remainingAssessmentMs(ms);
  await new Promise<void>((resolve, reject) => {
    const signal = execution.getStore()?.signal;
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (signal?.reason === "user_requested" || signal?.reason === "client_disconnect") {
        reject(new AssessmentCancelledError(signal.reason)); return;
      }
      reject(new AssessmentDeadlineError(
        signal?.reason === "assessment_deadline_exceeded" ? "overall" : execution.getStore()?.stage ?? "overall",
        signal?.reason === "assessment_deadline_exceeded" ? "assessment_deadline_exceeded" : "stage_deadline_exceeded")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, bounded);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
  assertAssessmentTime();
}
