import {
  readDeveloperSession,
} from "@/lib/auth/developer-session";

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

  return Response.redirect(
    installationUrl,
    302
  );
}
