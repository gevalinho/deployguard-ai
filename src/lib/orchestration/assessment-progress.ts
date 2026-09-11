export type AssessmentProgressStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "error"
  | "completed";

export interface AssessmentProgressEvent {
  stage: string;
  label: string;
  status: AssessmentProgressStatus;
  message?: string;
  elapsedMs?: number;
}

export type AssessmentProgressCallback = (
  event: AssessmentProgressEvent
) => void | Promise<void>;