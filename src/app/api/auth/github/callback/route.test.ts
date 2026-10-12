import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import {
  cookieValue,
  OAUTH_COOKIE,
  SESSION_COOKIE,
  seal,
  unseal,
} from "@/lib/auth/developer-session";
import type { OAuthState } from "@/lib/auth/github-developer-auth";

const SECRET = "test-session-secret-with-at-least-32-bytes";
const REDIRECT = "https://deployguard.example/api/auth/github/callback";

const originalSecret = process.env.DEPLOYGUARD_SESSION_SECRET;
const originalRedirect = process.env.GITHUB_APP_OAUTH_REDIRECT_URI;
const originalClientId = process.env.GITHUB_APP_CLIENT_ID;
const originalClientSecret = process.env.GITHUB_APP_CLIENT_SECRET;

function oauthState(expiresAt = Date.now() + 600_000): OAuthState {
  return {
    state: "test-oauth-state",
    verifier: "test-pkce-verifier",
    expiresAt,
  };
}

function callbackRequest(
  state: OAuthState,
  receivedState = state.state,
): Request {
  const url = new URL(REDIRECT);
  url.searchParams.set("code", "test-code");
  url.searchParams.set("state", receivedState);

  return new Request(url, {
    headers: {
      Cookie: `${OAUTH_COOKIE}=${seal(state)}`,
    },
  });
}

beforeEach(() => {
  process.env.DEPLOYGUARD_SESSION_SECRET = SECRET;
  process.env.GITHUB_APP_OAUTH_REDIRECT_URI = REDIRECT;
  process.env.GITHUB_APP_CLIENT_ID = "test-client-id";
  process.env.GITHUB_APP_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();

  for (const [name, value] of [
    ["DEPLOYGUARD_SESSION_SECRET", originalSecret],
    ["GITHUB_APP_OAUTH_REDIRECT_URI", originalRedirect],
    ["GITHUB_APP_CLIENT_ID", originalClientId],
    ["GITHUB_APP_CLIENT_SECRET", originalClientSecret],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("GitHub OAuth callback security", () => {
  it("rejects mismatched OAuth state without contacting GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(callbackRequest(oauthState(), "wrong-state"));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects expired OAuth state without contacting GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(callbackRequest(oauthState(Date.now() - 1_000)));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed signed OAuth state without contacting GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const malformed = {
      state: "test-oauth-state",
      verifier: null,
      expiresAt: "not-a-number",
    };

    const url = new URL(REDIRECT);
    url.searchParams.set("code", "test-code");
    url.searchParams.set("state", "test-oauth-state");

    const request = new Request(url, {
      headers: { Cookie: `${OAUTH_COOKIE}=${seal(malformed)}` },
    });

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears the temporary OAuth cookie after a rejected callback", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(callbackRequest(oauthState(), "wrong-state"));

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${OAUTH_COOKIE}=;`),
      ]),
    );
    expect(response.headers.getSetCookie().some((cookie) =>
      cookie.startsWith(`${OAUTH_COOKIE}=`) && cookie.includes("Max-Age=0"),
    )).toBe(true);
  });

  it("creates a session only after successful GitHub authentication", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "test-token" }))
      .mockResolvedValueOnce(Response.json({ id: 123, login: "developer" }));

    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(callbackRequest(oauthState()));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://deployguard.example/");

    const cookies = response.headers.getSetCookie();
    const sessionHeader = cookies.find((value) =>
      value.startsWith(`${SESSION_COOKIE}=`),
    );
    const oauthHeader = cookies.find((value) =>
      value.startsWith(`${OAUTH_COOKIE}=`),
    );

    expect(sessionHeader).toBeDefined();
    expect(oauthHeader).toContain("Max-Age=0");

    const sessionCookie = sessionHeader!.split(";")[0];
    const session = unseal<{
      githubId: string;
      login: string;
      expiresAt: number;
    }>(cookieValue(
      new Request(REDIRECT, { headers: { Cookie: sessionCookie } }),
      SESSION_COOKIE,
    ));

    expect(session?.githubId).toBe("123");
    expect(session?.login).toBe("developer");
    expect(session?.expiresAt).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not create a session when GitHub token exchange fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: "bad_verification_code" }, { status: 400 }),
      ),
    );

    const response = await GET(callbackRequest(oauthState()));

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie().some((value) =>
      value.startsWith(`${SESSION_COOKIE}=`),
    )).toBe(false);
  });
});
