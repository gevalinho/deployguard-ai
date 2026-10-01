import { createHash } from "node:crypto";
import { createInstallationAccessToken } from "@/lib/remediation/github-app-auth";
import { githubRemoteMatches } from "@/lib/remediation/github-app-git-transport";
import { newNonce } from "@/lib/auth/developer-session";

export interface OAuthState { state: string; verifier: string; expiresAt: number }
function config() {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_APP_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri || new URL(redirectUri).protocol !== "https:")
    throw new Error("GitHub developer OAuth is not configured.");
  return { clientId, clientSecret, redirectUri };
}
export function beginGitHubLogin(): { url: string; state: OAuthState } {
  const { clientId, redirectUri } = config();
  const state = { state: newNonce(), verifier: newNonce(), expiresAt: Date.now() + 10 * 60_000 };
  const challenge = createHash("sha256").update(state.verifier).digest("base64url");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state.state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), state };
}
export type GitHubOAuthFailureStage =
  | "token_endpoint_http"
  | "token_endpoint_network"
  | "token_response_invalid"
  | "token_missing"
  | "user_lookup_http"
  | "user_lookup_network"
  | "user_response_invalid"
  | "user_identity_invalid";

const SAFE_OAUTH_ERROR_CODES = new Set([
  "incorrect_client_credentials", "redirect_uri_mismatch", "bad_verification_code",
  "bad_refresh_token", "unverified_user_email", "access_denied", "invalid_request",
]);

export class GitHubOAuthFailure extends Error {
  constructor(
    readonly stage: GitHubOAuthFailureStage,
    readonly httpStatus?: number,
    readonly providerCode?: string,
  ) {
    super("GitHub developer OAuth failed.");
    this.name = "GitHubOAuthFailure";
  }
}

function safeProviderCode(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_OAUTH_ERROR_CODES.has(value) ? value : undefined;
}

export async function finishGitHubLogin(code: string, state: OAuthState): Promise<{ githubId: string; login: string }> {
  const { clientId, clientSecret, redirectUri } = config();
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code,
        redirect_uri: redirectUri, code_verifier: state.verifier }), cache: "no-store",
    });
  } catch {
    throw new GitHubOAuthFailure("token_endpoint_network");
  }
  let tokenBody: { access_token?: unknown; error?: unknown };
  try {
    tokenBody = await tokenResponse.json() as { access_token?: unknown; error?: unknown };
  } catch {
    throw new GitHubOAuthFailure(tokenResponse.ok ? "token_response_invalid" : "token_endpoint_http", tokenResponse.status);
  }
  const providerCode = safeProviderCode(tokenBody?.error);
  if (!tokenResponse.ok) throw new GitHubOAuthFailure("token_endpoint_http", tokenResponse.status, providerCode);
  if (typeof tokenBody?.access_token !== "string" || !tokenBody.access_token)
    throw new GitHubOAuthFailure("token_missing", tokenResponse.status, providerCode);
  let userResponse: Response;
  try {
    userResponse = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, Accept: "application/vnd.github+json" }, cache: "no-store",
    });
  } catch {
    throw new GitHubOAuthFailure("user_lookup_network");
  }
  if (!userResponse.ok) throw new GitHubOAuthFailure("user_lookup_http", userResponse.status);
  let user: { id?: unknown; login?: unknown };
  try {
    user = await userResponse.json() as { id?: unknown; login?: unknown };
  } catch {
    throw new GitHubOAuthFailure("user_response_invalid", userResponse.status);
  }
  if (!Number.isSafeInteger(user?.id) || typeof user?.login !== "string" || !/^[A-Za-z0-9-]+$/.test(user.login))
    throw new GitHubOAuthFailure("user_identity_invalid");
  return { githubId: String(user.id), login: user.login };
}
export async function authorizeDeveloperRepository(
  developer: { githubId: string; login: string }, repositoryIdentity: string,
  issueToken: typeof createInstallationAccessToken = createInstallationAccessToken,
  request: typeof fetch = fetch,
): Promise<boolean> {
  if (!githubRemoteMatches(repositoryIdentity, `https://github.com/${repositoryIdentity}.git`)) return false;
  const [owner, repository] = repositoryIdentity.split("/");
  const access = await issueToken(owner, repository, { pull_requests: "read" });
  const expiresAt = Date.parse(access.expiresAt);
  if (access.repositoryIdentity !== repositoryIdentity || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const response = await request(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/collaborators/${encodeURIComponent(developer.login)}/permission`, {
    headers: { Authorization: `Bearer ${access.token}`, Accept: "application/vnd.github+json" }, cache: "no-store",
  });
  if (!response.ok) return false;
  const result = await response.json() as { permission?: unknown; user?: { id?: unknown } };
  return String(result.user?.id) === developer.githubId &&
    ["admin", "maintain", "write"].includes(String(result.permission));
}
