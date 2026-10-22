import { describe, expect, it, vi } from "vitest";
import { assessmentStatus, finishAssessment, registerAssessment,
  requestAssessmentCancellation } from "../active-assessments";

describe("active assessment ownership", () => {
  it("requires the same developer and keeps cancellation idempotent", () => {
    const id = crypto.randomUUID();
    const cancel = vi.fn(() => true);
    expect(registerAssessment(id, "developer-1", cancel)).toBe(true);
    expect(registerAssessment(id, "developer-2", cancel)).toBe(false);
    expect(requestAssessmentCancellation(id, "developer-2")).toBeNull();
    expect(assessmentStatus(id, "developer-2")).toBeNull();
    expect(requestAssessmentCancellation(id, "developer-1")).toBe("cancellation_requested");
    expect(requestAssessmentCancellation(id, "developer-1")).toBe("cancellation_requested");
    expect(cancel).toHaveBeenCalledTimes(1);
    finishAssessment(id, "cancelled");
    expect(requestAssessmentCancellation(id, "developer-1")).toBe("cancelled");
  });

  it("does not cancel or replace an already completed terminal outcome", () => {
    const id = crypto.randomUUID();
    const cancel = vi.fn(() => true);
    registerAssessment(id, "developer", cancel);
    finishAssessment(id, "completed");
    expect(requestAssessmentCancellation(id, "developer")).toBe("completed");
    finishAssessment(id, "cancelled");
    expect(assessmentStatus(id, "developer")).toBe("completed");
    expect(cancel).not.toHaveBeenCalled();
  });
});
