import {
  createSign,
} from "node:crypto";

import {
  readFileSync,
} from "node:fs";

export interface GitHubAppCredentials {
  appId: string;
  privateKeyPath: string;
}

export interface GitHubRepositoryInstallation {
  id: number;

  accountLogin:
    | string
    | null;

  accountType:
    | string
    | null;
}

export interface GitHubInstallationAccessToken {
  token: string;
  expiresAt: string;

  installationId: number;
  repositoryIdentity: string;
}

export class GitHubRepositoryInstallationNotFoundError extends Error {
  constructor() {
    super("GitHub App installation was not found for this repository.");
    this.name = "GitHubRepositoryInstallationNotFoundError";
  }
}

interface GitHubInstallationResponse {
  id?: unknown;

  account?: {
    login?: unknown;
    type?: unknown;
  } | null;
}

interface GitHubInstallationTokenResponse {
  token?: unknown;
  expires_at?: unknown;
  permissions?: { contents?: unknown; pull_requests?: unknown };
  repositories?: Array<{ full_name?: unknown }>;
}

const GITHUB_API_BASE_URL =
  "https://api.github.com";

const GITHUB_API_VERSION =
  "2026-03-10";

/*
 * GitHub permits short-lived JWT authentication
 * for the GitHub App itself.
 *
 * Backdate issued-at slightly to tolerate small
 * clock differences between DeployGuard and
 * GitHub.
 */
const JWT_CLOCK_SKEW_SECONDS =
  60;

const JWT_LIFETIME_SECONDS =
  9 * 60;

function encodeBase64Url(
  value:
    | string
    | Buffer
): string {
  return Buffer
    .from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getGitHubAppCredentials():
  GitHubAppCredentials {
  const appId =
    process.env.GITHUB_APP_ID?.trim();

  const privateKeyPath =
    process.env
      .GITHUB_APP_PRIVATE_KEY_PATH
      ?.trim();

  if (!appId) {
    throw new Error(
      "GITHUB_APP_ID is required."
    );
  }

  if (!privateKeyPath) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY_PATH is required."
    );
  }

  return {
    appId,
    privateKeyPath,
  };
}

export function createGitHubAppJwt(
  credentials =
    getGitHubAppCredentials(),
  now = Date.now()
): string {
  const privateKey =
    readFileSync(
      credentials.privateKeyPath,
      "utf8"
    );

  const nowSeconds =
    Math.floor(
      now / 1000
    );

  const header = {
    alg:
      "RS256",

    typ:
      "JWT",
  };

  const payload = {
    iat:
      nowSeconds -
      JWT_CLOCK_SKEW_SECONDS,

    exp:
      nowSeconds +
      JWT_LIFETIME_SECONDS,

    iss:
      credentials.appId,
  };

  const encodedHeader =
    encodeBase64Url(
      JSON.stringify(header)
    );

  const encodedPayload =
    encodeBase64Url(
      JSON.stringify(payload)
    );

  const signingInput =
    `${encodedHeader}.${encodedPayload}`;

  const signer =
    createSign(
      "RSA-SHA256"
    );

  signer.update(
    signingInput
  );

  signer.end();

  const signature =
    signer.sign(
      privateKey
    );

  return (
    signingInput +
    "." +
    encodeBase64Url(
      signature
    )
  );
}

async function githubRequest(
  path: string,
  jwt: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(
    `${GITHUB_API_BASE_URL}${path}`,
    {
      ...init,

      headers: {
        Accept:
          "application/vnd.github+json",

        Authorization:
          `Bearer ${jwt}`,

        "X-GitHub-Api-Version":
          GITHUB_API_VERSION,

        ...init.headers,
      },
    }
  );
}

export async function getRepositoryInstallation(
  owner: string,
  repository: string,
  jwt =
    createGitHubAppJwt()
): Promise<GitHubRepositoryInstallation> {
  const response =
    await githubRequest(
      `/repos/${encodeURIComponent(
        owner
      )}/${encodeURIComponent(
        repository
      )}/installation`,
      jwt
    );

  if (response.status === 404) {
    throw new GitHubRepositoryInstallationNotFoundError();
  }

  if (!response.ok) {
    throw new Error(
      `GitHub repository installation lookup failed with status ${response.status}.`
    );
  }

  const data =
    await response.json() as
      GitHubInstallationResponse;

  if (
    typeof data.id !==
    "number"
  ) {
    throw new Error(
      "GitHub installation response did not contain a valid installation ID."
    );
  }

  return {
    id:
      data.id,

    accountLogin:
      typeof data.account?.login ===
      "string"
        ? data.account.login
        : null,

    accountType:
      typeof data.account?.type ===
      "string"
        ? data.account.type
        : null,
  };
}

export async function createInstallationAccessToken(
  owner: string,
  repository: string,
  permissions: { contents: "read" | "write"; pull_requests: "write" } |
    { contents: "read"; pull_requests: "read" } | { pull_requests: "read" } = {
    contents: "write", pull_requests: "write",
  },
): Promise<GitHubInstallationAccessToken> {
  /*
   * Generate App authority first.
   */
  const jwt =
    createGitHubAppJwt();

  /*
   * Resolve the installation from the exact
   * repository instead of accepting an arbitrary
   * installation ID from a caller.
   */
  const installation =
    await getRepositoryInstallation(
      owner,
      repository,
      jwt
    );

  /*
   * Scope the installation token to the exact
   * repository and only the permissions required
   * by DeployGuard's delivery boundary.
   */
  const response =
    await githubRequest(
      `/app/installations/${installation.id}/access_tokens`,
      jwt,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            repositories: [
              repository,
            ],

            permissions,
          }),
      }
    );

  if (!response.ok) {
    throw new Error(
      `GitHub installation token creation failed with status ${response.status}.`
    );
  }

  const data =
    await response.json() as
      GitHubInstallationTokenResponse;

  if (
    typeof data.token !==
      "string" ||
    !data.token ||
    typeof data.expires_at !==
      "string" ||
    data.permissions?.contents !== ("contents" in permissions ? permissions.contents : undefined) ||
    data.permissions?.pull_requests !== permissions.pull_requests ||
    data.repositories?.length !== 1 ||
    data.repositories[0].full_name !== `${owner}/${repository}`
  ) {
    throw new Error(
      "GitHub installation token response was incomplete."
    );
  }

  return {
    token:
      data.token,

    expiresAt:
      data.expires_at,

    installationId:
      installation.id,

    repositoryIdentity:
      `${owner}/${repository}`,
  };
}
