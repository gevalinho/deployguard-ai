import { beginGitHubLogin } from "@/lib/auth/github-developer-auth";
import { cookieOptions, OAUTH_COOKIE, seal } from "@/lib/auth/developer-session";
export const runtime = "nodejs";
export async function GET() {
  let stage: "login" | "redirect" | "session_cookie" | "cookie_header" = "login";
  try {
    const { url, state } = beginGitHubLogin();
    stage = "redirect";
    const response = new Response(null, { status: 302, headers: { Location: url } });
    stage = "session_cookie";
    const cookie = `${OAUTH_COOKIE}=${seal(state)}; ${cookieOptions(600)}`;
    stage = "cookie_header";
    response.headers.set("Set-Cookie", cookie);
    return response;
  } catch {
    // Fixed stage only: exceptions may contain OAuth values or credentials.
    console.error(`[DeployGuard Developer OAuth] start failed at ${stage}.`);
    return Response.json({ error: "Developer sign-in is unavailable." }, { status: 503 });
  }
}
