import assert from "node:assert/strict";
import { authorizeDeveloperRepository, beginGitHubLogin, finishGitHubLogin, GitHubOAuthFailure } from "@/lib/auth/github-developer-auth";
import { GET as completeGitHubLogin } from "@/app/api/auth/github/callback/route";
import { GET as startGitHubLogin } from "@/app/api/auth/github/start/route";
import { readDeveloperSession, sameOrigin, seal, unseal, SESSION_COOKIE, OAUTH_COOKIE } from "@/lib/auth/developer-session";

async function check() {
  process.env.DEPLOYGUARD_SESSION_SECRET = "a".repeat(40);
  process.env.GITHUB_APP_CLIENT_ID = "test-client";
  process.env.GITHUB_APP_CLIENT_SECRET = "test-secret";
  process.env.GITHUB_APP_OAUTH_REDIRECT_URI = "https://deployguard.test/api/auth/github/callback";
  const start = await startGitHubLogin();
  assert.equal(start.status, 302);
  assert.equal(new URL(start.headers.get("location")!).origin, "https://github.com");
  assert(start.headers.get("set-cookie")?.startsWith("deployguard_oauth="));
  const login = beginGitHubLogin();
  assert(new URL(login.url).searchParams.get("code_challenge"));
  assert(!login.url.includes("test-secret"));
  const value = seal({ githubId: "123", login: "developer", expiresAt: Date.now() + 1000 });
  const request = new Request("https://deployguard.test/api/remediation/delivery", { headers: { cookie: `${SESSION_COOKIE}=${value}`, origin: "https://deployguard.test" } });
  assert.equal(readDeveloperSession(request)?.githubId, "123");
  assert.equal(sameOrigin(request), true);
  assert.equal(unseal(`${value}x`), null);
  assert.equal(readDeveloperSession(new Request(request.url)), null);
  assert.equal(sameOrigin(new Request(request.url, { headers: { origin: "https://evil.test" } })), false);
  let scoped = false;
  const issue = async (owner: string, repository: string, permissions: unknown) => {
    scoped = owner === "owner" && repository === "repository" && JSON.stringify(permissions) === '{"pull_requests":"read"}';
    return { token: "secret-token", expiresAt: new Date(Date.now() + 60_000).toISOString(), installationId: 1,
      repositoryIdentity: "owner/repository" };
  };
  const api = async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer secret-token");
    return Response.json({ permission: "write", user: { id: 123 } });
  };
  const authorized = await authorizeDeveloperRepository({ githubId: "123", login: "developer" }, "owner/repository", issue, api);
  assert.equal(authorized, true); assert.equal(scoped, true);
  assert.equal(await authorizeDeveloperRepository({ githubId: "999", login: "developer" }, "owner/repository", issue, api), false);
  assert.equal(await authorizeDeveloperRepository({ githubId: "123", login: "developer" }, "owner/repository", issue,
    async () => Response.json({ permission: "read", user: { id: 123 } })), false);
  assert.equal(await authorizeDeveloperRepository({ githubId: "123", login: "developer" }, "owner/repository",
    async () => ({ token: "secret-token", expiresAt: "invalid", installationId: 1, repositoryIdentity: "owner/repository" }), api), false);
  assert.equal(await authorizeDeveloperRepository({ githubId: "123", login: "developer" }, "other/repository", issue, api), false);
  assert.equal(await authorizeDeveloperRepository({ githubId: "123", login: "developer" }, "bad/repo/extra", issue, api), false);
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs: string[] = [];
  const oauthState = { state: "private-state", verifier: "private-verifier", expiresAt: Date.now() + 60_000 };
  const callback = () => new Request("https://deployguard.test/api/auth/github/callback?code=private-code&state=private-state", {
    headers: { cookie: `${OAUTH_COOKIE}=${seal(oauthState)}` },
  });
  const expectFailure = async (responses: Response[], expectedStage: string) => {
    globalThis.fetch = async () => responses.shift()!;
    await assert.rejects(() => finishGitHubLogin("private-code", oauthState), (failure: unknown) =>
      failure instanceof GitHubOAuthFailure && failure.stage === expectedStage);
  };
  try {
    await expectFailure([Response.json({ error: "incorrect_client_credentials", access_token: "private-token" }, { status: 401 })], "token_endpoint_http");
    await expectFailure([Response.json({ error: "bad_verification_code" })], "token_missing");
    await expectFailure([Response.json({ access_token: "private-token" }), Response.json({}, { status: 401 })], "user_lookup_http");
    await expectFailure([Response.json({ access_token: "private-token" }), Response.json({ id: "wrong", login: "developer" })], "user_identity_invalid");
    globalThis.fetch = async () => Response.json({ error: "incorrect_client_credentials" });
    console.error = (message?: unknown) => { logs.push(String(message)); };
    const failedCallback = await completeGitHubLogin(callback());
    assert.equal(failedCallback.status, 401);
    assert.deepEqual(await failedCallback.json(), { error: "Developer sign-in failed." });
    assert(logs.some((line) => line.includes("token_missing") && line.includes("incorrect_client_credentials")));
    assert(logs.every((line) => !/private-code|private-token|private-state|private-verifier|test-secret/.test(line)));
    const invalidCallback = await completeGitHubLogin(new Request("https://deployguard.test/api/auth/github/callback"));
    assert.equal(invalidCallback.status, 401);
    assert(logs.some((line) => line.includes("state_validation")));
    globalThis.fetch = async (input) => String(input).endsWith("/user")
      ? Response.json({ id: 123, login: "developer" }) : Response.json({ access_token: "private-token" });
    const successfulCallback = await completeGitHubLogin(callback());
    assert.equal(successfulCallback.status, 302);
    assert.equal(successfulCallback.headers.get("location"), "https://deployguard.test/");
    assert(successfulCallback.headers.get("set-cookie")?.includes(`${SESSION_COOKIE}=`));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
  console.log("Developer session and repository authorization tests passed.");
}
check().catch(() => { console.error("Developer authorization tests failed."); process.exitCode = 1; });
