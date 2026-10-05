import { readDeveloperSession } from "@/lib/auth/developer-session";
import { authorizeDeveloperRepository } from "@/lib/auth/github-developer-auth";
import {
  clearInstallCookie, INSTALL_INTENT_COOKIE, INSTALL_RESULT_COOKIE,
  installCookie, readInstallIntent, type InstallOutcome,
} from "@/lib/auth/github-install-return";
import { parseGitHubRepositoryUrl } from "@/lib/repository/github-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const developer = readDeveloperSession(request);
  if (!developer) return Response.json({ ok: false, error: "Developer sign-in required." }, { status: 401 });

  const intent = readInstallIntent(request, developer, new URL(request.url).searchParams.get("state"));
  if (!intent) return Response.json({ ok: false, error: "Invalid or expired installation return." }, { status: 400 });

  let outcome: InstallOutcome;
  try {
    const repository = parseGitHubRepositoryUrl(intent.repositoryUrl);
    outcome = await authorizeDeveloperRepository(developer, repository.fullName) ? "success" : "incomplete";
  } catch (error) {
    console.error("[DeployGuard GitHub Install] Repository authorization verification failed.", error);
    outcome = "unavailable";
  }

  const destination = new URL("/", process.env.GITHUB_APP_OAUTH_REDIRECT_URI ?? request.url);
  destination.searchParams.set("github_authorization_return", "1");
  const response = new Response(null, {
    status: 302,
    headers: { Location: destination.toString() },
  });
  response.headers.append("Set-Cookie", clearInstallCookie(INSTALL_INTENT_COOKIE));
  response.headers.append("Set-Cookie", installCookie({
    action: "assessment", outcome, repositoryUrl: intent.repositoryUrl,
    developerId: developer.githubId, expiresAt: Date.now() + 60_000,
  }, INSTALL_RESULT_COOKIE));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
