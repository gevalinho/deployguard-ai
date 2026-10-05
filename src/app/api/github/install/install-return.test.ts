import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, session } = vi.hoisted(() => ({ authorize: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/auth/developer-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/developer-session")>()),
  readDeveloperSession: session,
}));
vi.mock("@/lib/auth/github-developer-auth", () => ({ authorizeDeveloperRepository: authorize }));

import { GET as begin } from "./route";
import { GET as complete } from "./callback/route";
import { POST as resume } from "./resume/route";
import { INSTALL_INTENT_COOKIE, INSTALL_RESULT_COOKIE } from "@/lib/auth/github-install-return";

const base = "https://deployguard.test";
const repositoryUrl = "https://github.com/owner/repository";
const developer = { githubId: "123", login: "developer", expiresAt: Date.now() + 60_000 };

function cookie(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  if (!header) throw new Error(`Missing ${name} cookie.`);
  return header.split(";")[0];
}

async function started() {
  const response = await begin(new Request(`${base}/api/github/install?repositoryUrl=${encodeURIComponent(repositoryUrl)}`));
  const location = new URL(response.headers.get("location")!);
  return { response, state: location.searchParams.get("state")!, intentCookie: cookie(response, INSTALL_INTENT_COOKIE) };
}

describe("GitHub App installation return", () => {
  beforeEach(() => {
    process.env.DEPLOYGUARD_SESSION_SECRET = "test-secret".repeat(4);
    process.env.GITHUB_APP_SLUG = "deployguard-ai";
    process.env.GITHUB_APP_OAUTH_REDIRECT_URI = `${base}/api/auth/github/callback`;
    session.mockReturnValue(developer);
    authorize.mockReset();
  });

  it("starts with signed assessment intent and an opaque GitHub state", async () => {
    const { response, state, intentCookie } = await started();
    expect(response.status).toBe(302);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get("location")).not.toContain("owner/repository");
    expect(intentCookie).toContain(INSTALL_INTENT_COOKIE);
  });

  it("preserves the existing direct installation link", async () => {
    const response = await begin(new Request(`${base}/api/github/install`));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://github.com/apps/deployguard-ai/installations/new");
  });

  it.each([
    [true, "success"],
    [false, "incomplete"],
  ])("verifies the signed-in developer and returns %s as %s", async (authorized, outcome) => {
    const { state, intentCookie } = await started();
    authorize.mockResolvedValue(authorized);
    const response = await complete(new Request(`${base}/api/github/install/callback?state=${state}&installation_id=999`, {
      headers: { cookie: intentCookie },
    }));
    expect(response.status).toBe(302);
    expect(authorize).toHaveBeenCalledWith(developer, "owner/repository");
    expect(response.headers.get("location")).toBe(`${base}/?github_authorization_return=1`);
    const resultCookie = cookie(response, INSTALL_RESULT_COOKIE);
    const result = await resume(new Request(`${base}/api/github/install/resume`, {
      method: "POST", headers: { cookie: resultCookie, origin: base },
    }));
    expect(await result.json()).toEqual({ ok: true, outcome, repositoryUrl });
    expect(cookie(result, INSTALL_RESULT_COOKIE)).toBe(`${INSTALL_RESULT_COOKIE}=`);
    const second = await resume(new Request(`${base}/api/github/install/resume`, {
      method: "POST", headers: { origin: base },
    }));
    expect(second.status).toBe(400);
  });

  it("returns unavailable when repository verification fails", async () => {
    const { state, intentCookie } = await started();
    authorize.mockRejectedValue(new Error("GitHub unavailable"));
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await complete(new Request(`${base}/api/github/install/callback?state=${state}`, {
        headers: { cookie: intentCookie },
      }));
      const result = await resume(new Request(`${base}/api/github/install/resume`, {
        method: "POST", headers: { cookie: cookie(response, INSTALL_RESULT_COOKIE), origin: base },
      }));
      expect((await result.json()).outcome).toBe("unavailable");
    } finally { logging.mockRestore(); }
  });

  it("rejects changed, expired, malformed, and other-developer state", async () => {
    const { state, intentCookie } = await started();
    const valid = new Request(`${base}/api/github/install/callback?state=${state}`, { headers: { cookie: intentCookie } });
    session.mockReturnValue({ ...developer, githubId: "456" });
    expect((await complete(valid)).status).toBe(400);
    session.mockReturnValue(developer);
    expect((await complete(new Request(`${base}/api/github/install/callback?state=wrong`, { headers: { cookie: intentCookie } }))).status).toBe(400);
    expect((await complete(new Request(`${base}/api/github/install/callback?state=${state}`, { headers: { cookie: `${INSTALL_INTENT_COOKIE}=broken` } }))).status).toBe(400);
    expect((await complete(new Request(`${base}/api/github/install/callback?state=${state}`))).status).toBe(400);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    try {
      expect((await complete(valid)).status).toBe(400);
    } finally { clock.mockRestore(); }
    session.mockReturnValue(null);
    expect((await complete(valid)).status).toBe(401);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("does not hand a resume result to a different developer", async () => {
    const { state, intentCookie } = await started();
    authorize.mockResolvedValue(true);
    const response = await complete(new Request(`${base}/api/github/install/callback?state=${state}`, {
      headers: { cookie: intentCookie },
    }));
    session.mockReturnValue({ ...developer, githubId: "456" });
    const result = await resume(new Request(`${base}/api/github/install/resume`, {
      method: "POST", headers: { cookie: cookie(response, INSTALL_RESULT_COOKIE), origin: base },
    }));
    expect(result.status).toBe(400);
  });

  it("rejects cross-origin attempts to consume a resume result", async () => {
    const response = await resume(new Request(`${base}/api/github/install/resume`, {
      method: "POST", headers: { origin: "https://other.test" },
    }));
    expect(response.status).toBe(403);
  });
});
