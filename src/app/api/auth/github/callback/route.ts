import { finishGitHubLogin, type OAuthState } from "@/lib/auth/github-developer-auth";
import { cookieOptions, cookieValue, OAUTH_COOKIE, seal, SESSION_COOKIE, unseal } from "@/lib/auth/developer-session";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = unseal<OAuthState>(cookieValue(request, OAUTH_COOKIE));
  const code = url.searchParams.get("code");
  const received = url.searchParams.get("state");
  if (!state || !code || !received || received !== state.state || state.expiresAt <= Date.now())
    return Response.json({ error: "Invalid developer sign-in." }, { status: 401 });
  try {
    const developer = await finishGitHubLogin(code, state);
    const response = Response.redirect(new URL("/", request.url), 302);
    response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${seal({ ...developer, expiresAt: Date.now() + 8 * 60 * 60_000 })}; ${cookieOptions(8 * 60 * 60)}`);
    response.headers.append("Set-Cookie", `${OAUTH_COOKIE}=; ${cookieOptions(0)}`);
    return response;
  } catch { return Response.json({ error: "Developer sign-in failed." }, { status: 401 }); }
}
