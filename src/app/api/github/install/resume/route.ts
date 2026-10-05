import { readDeveloperSession, sameOrigin } from "@/lib/auth/developer-session";
import { clearInstallCookie, INSTALL_RESULT_COOKIE, readInstallResult } from "@/lib/auth/github-install-return";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
  }
  const developer = readDeveloperSession(request);
  const result = developer ? readInstallResult(request, developer) : null;
  const response = Response.json(result
    ? { ok: true, outcome: result.outcome, repositoryUrl: result.repositoryUrl }
    : { ok: false, error: "No valid installation return is available." },
  { status: result ? 200 : 400 });
  response.headers.set("Set-Cookie", clearInstallCookie(INSTALL_RESULT_COOKIE));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
