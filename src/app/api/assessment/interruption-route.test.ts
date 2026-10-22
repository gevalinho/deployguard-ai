import { describe, expect, it, vi } from "vitest";

const failure = vi.hoisted(() => ({ raw: false, deadline: false, authorizationDeadline: false,
  waitAuthorization: false, waitIngestion: false, unknownDocker: false,
  cancelUnknownDocker: false, cancelCleanupFailure: false }));

vi.mock("@/lib/auth/developer-session", () => ({
  readDeveloperSession: () => ({ githubId: "1", login: "developer" }),
  sameOrigin: () => true,
}));
vi.mock("@/lib/auth/github-developer-auth", () => ({
  authorizeDeveloperRepository: async () => {
    if (failure.waitAuthorization) {
      const { currentAssessmentExecution } = await import("@/lib/orchestration/assessment-execution");
      await new Promise<void>((_resolve, reject) => {
        const signal = currentAssessmentExecution()?.signal;
        if (signal?.aborted) reject(new Error("cancelled"));
        else signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
    }
    if (failure.authorizationDeadline) {
      const { AssessmentDeadlineError } = await import("@/lib/orchestration/assessment-execution");
      throw new AssessmentDeadlineError("authorization", "stage_deadline_exceeded");
    }
    return true;
  },
}));
vi.mock("@/lib/orchestration/remote-readiness-orchestrator", () => ({
  runRemoteReadinessAssessment: async () => {
    if (failure.cancelCleanupFailure) {
      const { currentAssessmentExecution } = await import("@/lib/orchestration/assessment-execution");
      await new Promise<void>((resolve) => {
        const signal = currentAssessmentExecution()?.signal;
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      const { AssessmentInterruptedError } = await import("@/lib/orchestration/assessment-interruption");
      throw new AssessmentInterruptedError({ stage: "execution", service: "assessment service",
        reason: "assessment_cleanup_unconfirmed", retryable: false });
    }
    if (failure.cancelUnknownDocker) {
      const { currentAssessmentExecution } = await import("@/lib/orchestration/assessment-execution");
      await new Promise<void>((resolve) => {
        const signal = currentAssessmentExecution()?.signal;
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      const { AssessmentInterruptedError } = await import("@/lib/orchestration/assessment-interruption");
      throw new AssessmentInterruptedError({ stage: "execution", service: "Docker sandbox",
        reason: "sandbox_cleanup_unconfirmed", retryable: false });
    }
    if (failure.waitIngestion) {
      const { currentAssessmentExecution } = await import("@/lib/orchestration/assessment-execution");
      await new Promise<void>((_resolve, reject) => {
        const signal = currentAssessmentExecution()?.signal;
        if (signal?.aborted) reject(new Error("cancelled"));
        else signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
    }
    if (failure.unknownDocker) {
      const { AssessmentInterruptedError } = await import("@/lib/orchestration/assessment-interruption");
      throw new AssessmentInterruptedError({ stage: "execution", service: "Docker sandbox",
        reason: "sandbox_cleanup_unconfirmed", retryable: false });
    }
    if (failure.deadline) {
      const { AssessmentDeadlineError } = await import("@/lib/orchestration/assessment-execution");
      throw new AssessmentDeadlineError("repository", "stage_deadline_exceeded");
    }
    const { AssessmentInterruptedError } = await import("@/lib/orchestration/assessment-interruption");
    throw new AssessmentInterruptedError({
      stage: "preparation", service: "package registry",
      reason: "dependency_registry_unavailable", retryable: true,
    });
  },
}));

import { POST } from "./route";
import { POST as CANCEL, GET as STATUS } from "./cancel/route";

const requestBody = (assessmentId: string) => new Request("https://deployguard.test/api/assessment", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://deployguard.test" },
  body: JSON.stringify({ repositoryUrl: "https://github.com/owner/repo", assessmentId }),
});
const cancelBody = (assessmentId: string) => new Request("https://deployguard.test/api/assessment/cancel", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://deployguard.test" },
  body: JSON.stringify({ assessmentId }),
});

describe("assessment interruption SSE contract", () => {
  it("does not confirm cancellation when workspace cleanup fails", async () => {
    failure.cancelCleanupFailure = true;
    const id = crypto.randomUUID();
    try {
      const response = await POST(requestBody(id));
      expect((await (await CANCEL(cancelBody(id))).json()).status).toBe("cancellation_requested");
      const body = await response.text();
      expect(body).toContain('"reason":"assessment_cleanup_unconfirmed"');
      expect(body).not.toMatch(/event: cancelled|event: result|readinessVerdict|"score"/);
      expect((await (await STATUS(new Request(
        `https://deployguard.test/api/assessment/cancel?assessmentId=${id}`))).json()).status)
        .toBe("cleanup_unconfirmed");
    } finally { failure.cancelCleanupFailure = false; }
  });
  it("confirms repeated cancellation during authorization without opening SSE", async () => {
    failure.waitAuthorization = true;
    const id = crypto.randomUUID();
    try {
      const pending = POST(requestBody(id));
      await vi.waitFor(async () => expect((await STATUS(new Request(
        `https://deployguard.test/api/assessment/cancel?assessmentId=${id}`))).status).toBe(200));
      expect(["cancellation_requested", "cancelled"]).toContain(
        (await (await CANCEL(cancelBody(id))).json()).status);
      expect(["cancellation_requested", "cancelled"]).toContain(
        (await (await CANCEL(cancelBody(id))).json()).status);
      const response = await pending;
      expect(response.status).toBe(409);
      expect(await response.text()).toContain("ASSESSMENT_CANCELLED");
      expect((await (await STATUS(new Request(
        `https://deployguard.test/api/assessment/cancel?assessmentId=${id}`))).json()).status).toBe("cancelled");
    } finally { failure.waitAuthorization = false; }
  });

  it("confirms cancellation during ingestion with one terminal event and no score", async () => {
    failure.waitIngestion = true;
    const id = crypto.randomUUID();
    try {
      const response = await POST(requestBody(id));
      expect((await (await CANCEL(cancelBody(id))).json()).status).toBe("cancellation_requested");
      const body = await response.text();
      expect(body.match(/event: cancelled/g)).toHaveLength(1);
      expect(body).not.toMatch(/event: result|readinessVerdict|"score"/);
    } finally { failure.waitIngestion = false; }
  });

  it("keeps the server running when the browser disconnects without a cancellation request", async () => {
    failure.waitIngestion = true;
    const id = crypto.randomUUID();
    try {
      const response = await POST(requestBody(id));
      await response.body?.cancel();
      expect((await (await STATUS(new Request(
        `https://deployguard.test/api/assessment/cancel?assessmentId=${id}`))).json()).status).toBe("running");
      await CANCEL(cancelBody(id));
      await vi.waitFor(async () => expect((await (await STATUS(new Request(
        `https://deployguard.test/api/assessment/cancel?assessmentId=${id}`))).json()).status).toBe("cancelled"));
    } finally { failure.waitIngestion = false; }
  });

  it("does not confirm cancellation when Docker cleanup is unresolved", async () => {
    failure.unknownDocker = true;
    const id = crypto.randomUUID();
    try {
      const body = await (await POST(requestBody(id))).text();
      expect(body).toContain('"reason":"sandbox_cleanup_unconfirmed"');
      expect((await (await CANCEL(cancelBody(id))).json()).status).toBe("cleanup_unconfirmed");
    } finally { failure.unknownDocker = false; }
  });

  it("preserves cleanup-unconfirmed when cancellation races Docker reconciliation", async () => {
    failure.cancelUnknownDocker = true;
    const id = crypto.randomUUID();
    try {
      const response = await POST(requestBody(id));
      expect((await (await CANCEL(cancelBody(id))).json()).status).toBe("cancellation_requested");
      const body = await response.text();
      expect(body).toContain('"reason":"sandbox_cleanup_unconfirmed"');
      expect(body).not.toContain("event: cancelled");
      expect((await (await STATUS(new Request(
        `https://deployguard.test/api/assessment/cancel?assessmentId=${id}`))).json()).status)
        .toBe("cleanup_unconfirmed");
    } finally { failure.cancelUnknownDocker = false; }
  });
  it("returns a controlled authorization timeout before opening SSE", async () => {
    failure.authorizationDeadline = true;
    try {
      const response = await POST(new Request("https://deployguard.test/api/assessment", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "https://deployguard.test" },
        body: JSON.stringify({ repositoryUrl: "https://github.com/owner/repo" }),
      }));
      expect(response.status).toBe(503);
      expect(await response.text()).toContain("ASSESSMENT_DEADLINE_EXCEEDED");
    } finally { failure.authorizationDeadline = false; }
  });

  it("ends with one interruption event and no score when ingestion exceeds its deadline", async () => {
    failure.deadline = true;
    try {
      const response = await POST(new Request("https://deployguard.test/api/assessment", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "https://deployguard.test" },
        body: JSON.stringify({ repositoryUrl: "https://github.com/owner/repo" }),
      }));
      const body = await response.text();
      expect(body.match(/event: interrupted/g)).toHaveLength(1);
      expect(body).toContain('"reason":"stage_deadline_exceeded"');
      expect(body).not.toMatch(/event: result|readinessVerdict|"score"/);
    } finally { failure.deadline = false; }
  });
  it("sends an interrupted terminal event without a successful result or score", async () => {
    const response = await POST(new Request("https://deployguard.test/api/assessment", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://deployguard.test" },
      body: JSON.stringify({ repositoryUrl: "https://github.com/owner/repo" }),
    }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("event: interrupted");
    expect(body).toContain('"reason":"dependency_registry_unavailable"');
    expect(body).not.toContain("event: result");
    expect(body).not.toContain('"readiness"');
    expect(body).not.toContain('"readinessVerdict"');
    expect(body).not.toContain("100/100");
  });
});
