import {
  readDeveloperSession,
} from "@/lib/auth/developer-session";
import { createInstallIntent, INSTALL_INTENT_COOKIE, installCookie } from "@/lib/auth/github-install-return";

export const runtime = "nodejs";

export async function GET(
  request: Request
) {
  const developer =
    readDeveloperSession(request);

  if (!developer) {
    return Response.json(
      {
        ok: false,
        error:
          "Developer sign-in required.",
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const appSlug =
    process.env.GITHUB_APP_SLUG
      ?.trim();

  if (
    !appSlug ||
    !/^[A-Za-z0-9-]+$/.test(
      appSlug
    )
  ) {
    return Response.json(
      {
        ok: false,
        error:
          "GitHub App installation is not configured.",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const installationUrl =
    new URL(
      `https://github.com/apps/${appSlug}/installations/new`
    );

  const repositoryUrl = new URL(request.url).searchParams.get("repositoryUrl");
  if (!repositoryUrl) {
    return Response.redirect(installationUrl, 302);
  }

  let intent;
  try {
    intent = createInstallIntent(repositoryUrl, developer);
  } catch {
    return Response.json({ ok: false, error: "A valid GitHub repository URL is required." }, { status: 400 });
  }

  installationUrl.searchParams.set("state", intent.nonce);

  const response = new Response(null, {
    status: 302,
    headers: { Location: installationUrl.toString() },
  });
  response.headers.set("Set-Cookie", installCookie(intent, INSTALL_INTENT_COOKIE));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
