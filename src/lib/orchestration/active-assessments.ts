import type { AssessmentCancellationReason } from "./assessment-execution";

export type AssessmentLifecycle = "running" | "cancellation_requested" | "cancelled" |
  "cleanup_unconfirmed" | "completed" | "interrupted" | "failed";

interface ActiveAssessment {
  owner: string;
  status: AssessmentLifecycle;
  clientDisconnected: boolean;
  cancel: (reason: AssessmentCancellationReason) => boolean;
  expires?: ReturnType<typeof setTimeout>;
}

const assessments = new Map<string, ActiveAssessment>();
const TERMINAL_RETENTION_MS = 5 * 60_000;
export const validAssessmentId = (id: unknown): id is string =>
  typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export function registerAssessment(id: string, owner: string,
  cancel: ActiveAssessment["cancel"]): boolean {
  if (assessments.has(id)) return false;
  assessments.set(id, { owner, status: "running", clientDisconnected: false, cancel });
  return true;
}

export function assessmentStatus(id: string, owner: string): AssessmentLifecycle | null {
  const entry = assessments.get(id);
  return entry?.owner === owner ? entry.status : null;
}

export function markAssessmentClientDisconnected(id: string): void {
  const entry = assessments.get(id);
  if (entry && (entry.status === "running" || entry.status === "cancellation_requested"))
    entry.clientDisconnected = true;
}

export function requestAssessmentCancellation(id: string, owner: string): AssessmentLifecycle | null {
  const entry = assessments.get(id);
  if (!entry || entry.owner !== owner) return null;
  if (entry.status === "running") {
    if (entry.cancel("user_requested")) entry.status = "cancellation_requested";
  }
  return entry.status;
}

export function finishAssessment(id: string, status: Exclude<AssessmentLifecycle,
  "running" | "cancellation_requested">): void {
  const entry = assessments.get(id);
  if (!entry || (entry.status !== "running" && entry.status !== "cancellation_requested")) return;
  entry.status = status;
  entry.expires = setTimeout(() => { if (assessments.get(id) === entry) assessments.delete(id); },
    TERMINAL_RETENTION_MS);
  entry.expires.unref?.();
}
