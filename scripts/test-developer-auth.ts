import assert from "node:assert/strict";
import { authorizeDeveloperRepository, beginGitHubLogin } from "@/lib/auth/github-developer-auth";
import { readDeveloperSession, sameOrigin, seal, unseal, SESSION_COOKIE } from "@/lib/auth/developer-session";

async function check() {
  process.env.DEPLOYGUARD_SESSION_SECRET = "a".repeat(40);
  process.env.GITHUB_APP_CLIENT_ID = "test-client";
  process.env.GITHUB_APP_CLIENT_SECRET = "test-secret";
  process.env.GITHUB_APP_OAUTH_REDIRECT_URI = "https://deployguard.test/api/auth/github/callback";
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
  console.log("Developer session and repository authorization tests passed.");
}
check().catch(() => { console.error("Developer authorization tests failed."); process.exitCode = 1; });
