import { beforeEach, describe, expect, it, vi } from "vitest";

const { issueToken, session } = vi.hoisted(() => ({
  issueToken: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/auth/developer-session", () => ({
  readDeveloperSession: session,
  sameOrigin: () => true,
}));

vi.mock("@/lib/remediation/github-app-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/remediation/github-app-auth")>()),
  createInstallationAccessToken: issueToken,
}));

import { POST } from "./route";
import { GitHubRepositoryInstallationNotFoundError } from "@/lib/remediation/github-app-auth";

describe("assessment repository authorization responses", () => {
  beforeEach(() => {
    issueToken.mockReset();
    session.mockReturnValue({ githubId: "1", login: "developer" });
  });

  const request = () =>
    new Request("https://deployguard.test/api/assessment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repositoryUrl: "https://github.com/owner/repo" }),
    });

  it("marks a denied repository as requiring authorization", async () => {
    issueToken.mockRejectedValue(new GitHubRepositoryInstallationNotFoundError());

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      code: "REPOSITORY_AUTHORIZATION_REQUIRED",
      error: "Repository assessment is not authorized.",
    });
  });

  it("marks an authorization lookup failure as unavailable", async () => {
    issueToken.mockRejectedValue(new Error("GitHub repository installation lookup failed with status 500."));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await POST(request());

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        code: "REPOSITORY_AUTHORIZATION_UNAVAILABLE",
        error: "Repository authorization could not be verified.",
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
