import { beginGitHubLogin } from "@/lib/auth/github-developer-auth";
import { cookieOptions, OAUTH_COOKIE, seal } from "@/lib/auth/developer-session";
export const runtime = "nodejs";
export async function GET() {
  try {
    const { url, state } = beginGitHubLogin();
    const response = Response.redirect(url, 302);
    response.headers.set("Set-Cookie", `${OAUTH_COOKIE}=${seal(state)}; ${cookieOptions(600)}`);
    return response;
  } catch { return Response.json({ error: "Developer sign-in is unavailable." }, { status: 503 }); }
}
