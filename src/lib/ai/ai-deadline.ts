import { AssessmentCancelledError, AssessmentDeadlineError, currentAssessmentExecution,
  remainingAssessmentMs } from "@/lib/orchestration/assessment-execution";

export async function runAiWithDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const effectiveTimeoutMs = remainingAssessmentMs(timeoutMs);
  const assessmentSignal = currentAssessmentExecution()?.signal;
  let rejectCancellation!: (reason: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const cancel = () => {
    controller.abort();
    rejectCancellation(assessmentSignal?.reason === "user_requested" ||
      assessmentSignal?.reason === "client_disconnect"
      ? new AssessmentCancelledError(assessmentSignal.reason)
      : new AssessmentDeadlineError("optional", assessmentSignal?.reason === "assessment_deadline_exceeded"
        ? "assessment_deadline_exceeded" : "stage_deadline_exceeded"));
  };
  if (assessmentSignal?.aborted) cancel();
  else assessmentSignal?.addEventListener("abort", cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("AI request timed out."));
    }, effectiveTimeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline, cancellation]);
  } finally {
    if (timer) clearTimeout(timer);
    assessmentSignal?.removeEventListener("abort", cancel);
  }
}
