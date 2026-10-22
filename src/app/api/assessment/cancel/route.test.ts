import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/developer-session", () => ({
  readDeveloperSession: (request: Request) => {
    const owner = request.headers.get("x-test-owner");
    return owner ? { githubId: owner, login: owner } : null;
  },
  sameOrigin: (request: Request) => request.headers.get("origin") === "https://deployguard.test",
}));

import { registerAssessment, assessmentStatus } from "@/lib/orchestration/active-assessments";
import { POST } from "./route";

const request = (assessmentId: string, owner?: string, origin = "https://deployguard.test") =>
  new Request("https://deployguard.test/api/assessment/cancel", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin,
      ...(owner ? { "x-test-owner": owner } : {}) },
    body: JSON.stringify({ assessmentId }),
  });

describe("HTTP cancellation ownership", () => {
  it("rejects unauthenticated, wrong-origin, and wrong-owner requests", async () => {
    const id = crypto.randomUUID();
    const cancel = vi.fn(() => true);
    expect(registerAssessment(id, "owner-1", cancel)).toBe(true);
    expect((await POST(request(id))).status).toBe(401);
    expect((await POST(request(id, "owner-1", "https://attacker.test"))).status).toBe(403);
    expect((await POST(request(id, "owner-2"))).status).toBe(404);
    expect(cancel).not.toHaveBeenCalled();
    expect(assessmentStatus(id, "owner-1")).toBe("running");
    expect((await (await POST(request(id, "owner-1"))).json()).status).toBe("cancellation_requested");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
