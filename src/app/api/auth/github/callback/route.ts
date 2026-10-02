import { finishGitHubLogin, GitHubOAuthFailure, type OAuthState } from "@/lib/auth/github-developer-auth";
import { cookieOptions, cookieValue, OAUTH_COOKIE, seal, SESSION_COOKIE, unseal } from "@/lib/auth/developer-session";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = unseal<OAuthState>(cookieValue(request, OAUTH_COOKIE));
  const code = url.searchParams.get("code");
  const received = url.searchParams.get("state");
  if (!state || !code || !received || received !== state.state || state.expiresAt <= Date.now()) {
    console.error("[DeployGuard Developer OAuth] callback failed at state_validation.");
    return Response.json({ error: "Invalid developer sign-in." }, { status: 401 });
  }
  let stage: "token_exchange" | "redirect" | "session_cookie" | "cookie_header" = "token_exchange";
  try {
    const developer = await finishGitHubLogin(code, state);
    stage = "redirect";

const redirectUri = process.env.GITHUB_APP_OAUTH_REDIRECT_URI;

if (!redirectUri) {
  throw new Error("GitHub OAuth redirect URI is not configured.");
}

const response = new Response(null, {
  status: 302,
  headers: {
    Location: new URL("/", redirectUri).toString(),
  },
});
    stage = "session_cookie";
    const sessionCookie = `${SESSION_COOKIE}=${seal({ ...developer, expiresAt: Date.now() + 8 * 60 * 60_000 })}; ${cookieOptions(8 * 60 * 60)}`;
    stage = "cookie_header";
    response.headers.append("Set-Cookie", sessionCookie);
    response.headers.append("Set-Cookie", `${OAUTH_COOKIE}=; ${cookieOptions(0)}`);
    return response;
  } catch (failure) {
    if (failure instanceof GitHubOAuthFailure) {
      console.error(`[DeployGuard Developer OAuth] callback failed at ${failure.stage}; status=${failure.httpStatus ?? "none"}; code=${failure.providerCode ?? "none"}.`);
    } else {
      console.error(`[DeployGuard Developer OAuth] callback failed at ${stage}.`);
    }
    return Response.json({ error: "Developer sign-in failed." }, { status: 401 });
  }
}
