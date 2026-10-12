import {
  finishGitHubLogin,
  GitHubOAuthFailure,
  type OAuthState,
} from "@/lib/auth/github-developer-auth";

import {
  cookieOptions,
  cookieValue,
  OAUTH_COOKIE,
  seal,
  SESSION_COOKIE,
  unseal,
} from "@/lib/auth/developer-session";

export const runtime = "nodejs";

function validOAuthState(value: unknown): value is OAuthState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const state = value as Record<string, unknown>;

  return (
    typeof state.state === "string" &&
    state.state.length > 0 &&
    typeof state.verifier === "string" &&
    state.verifier.length > 0 &&
    typeof state.expiresAt === "number" &&
    Number.isFinite(state.expiresAt) &&
    state.expiresAt > Date.now()
  );
}

function authenticationFailure(
  message: string,
): Response {
  const response = Response.json(
    { error: message },
    { status: 401 },
  );

  response.headers.append(
    "Set-Cookie",
    `${OAUTH_COOKIE}=; ${cookieOptions(0)}`,
  );

  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const state = unseal<unknown>(
    cookieValue(request, OAUTH_COOKIE),
  );

  const code = url.searchParams.get("code");
  const received = url.searchParams.get("state");

  if (
    !validOAuthState(state) ||
    !code ||
    !received ||
    received !== state.state
  ) {
    console.error(
      "[DeployGuard Developer OAuth] callback failed at state_validation.",
    );

    return authenticationFailure(
      "Invalid developer sign-in.",
    );
  }

  let stage:
    | "token_exchange"
    | "redirect"
    | "session_cookie"
    | "cookie_header" = "token_exchange";

  try {
    const developer = await finishGitHubLogin(code, state);

    stage = "redirect";

    const redirectUri =
      process.env.GITHUB_APP_OAUTH_REDIRECT_URI;

    if (!redirectUri) {
      throw new Error(
        "GitHub OAuth redirect URI is not configured.",
      );
    }

    const response = new Response(null, {
      status: 302,
      headers: {
        Location: new URL("/", redirectUri).toString(),
      },
    });

    stage = "session_cookie";

    const sessionCookie =
      `${SESSION_COOKIE}=${seal({
        ...developer,
        expiresAt: Date.now() + 8 * 60 * 60_000,
      })}; ${cookieOptions(8 * 60 * 60)}`;

    stage = "cookie_header";

    response.headers.append(
      "Set-Cookie",
      sessionCookie,
    );

    response.headers.append(
      "Set-Cookie",
      `${OAUTH_COOKIE}=; ${cookieOptions(0)}`,
    );

    return response;
  } catch (failure) {
    if (failure instanceof GitHubOAuthFailure) {
      console.error(
        `[DeployGuard Developer OAuth] callback failed at ${failure.stage}; status=${failure.httpStatus ?? "none"}; code=${failure.providerCode ?? "none"}.`,
      );
    } else {
      console.error(
        `[DeployGuard Developer OAuth] callback failed at ${stage}.`,
      );
    }

    return authenticationFailure(
      "Developer sign-in failed.",
    );
  }
}
