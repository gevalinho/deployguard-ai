import "dotenv/config";

import {
  createGitHubAppJwt,
  getRepositoryInstallation,
  createInstallationAccessToken,
} from "@/lib/remediation/github-app-auth";

async function main(): Promise<void> {
  const owner =
    "gevalinho";

  const repository =
    "deployguard-ai";

  console.log(
    "\n=== DeployGuard GitHub App Authentication Test ===\n"
  );

  /*
   * 1. Prove that DeployGuard can construct
   * GitHub App authority from the configured
   * App ID and private key.
   *
   * Never print the JWT.
   */
  const jwt =
    createGitHubAppJwt();

  if (
    !jwt ||
    jwt.split(".").length !== 3
  ) {
    throw new Error(
      "GitHub App JWT was not generated correctly."
    );
  }

  console.log(
    "✓ GitHub App JWT generated."
  );

  /*
   * 2. Prove that GitHub recognizes this App
   * as installed on the exact repository.
   */
  const installation =
    await getRepositoryInstallation(
      owner,
      repository,
      jwt
    );

  console.log(
    `✓ GitHub installation resolved for ${owner}/${repository}.`
  );

  console.log(
    `  Installation ID: ${installation.id}`
  );

  console.log(
    `  Account: ${installation.accountLogin ?? "unknown"}`
  );

  /*
   * 3. Exchange App authority for a short-lived,
   * repository-scoped installation token.
   *
   * Never print the token.
   */
  const access =
    await createInstallationAccessToken(
      owner,
      repository
    );

  if (
    access.repositoryIdentity !==
    `${owner}/${repository}`
  ) {
    throw new Error(
      "Installation token repository identity mismatch."
    );
  }

  if (
    access.installationId !==
    installation.id
  ) {
    throw new Error(
      "Installation identity changed during token issuance."
    );
  }

  const expiresAt =
    Date.parse(
      access.expiresAt
    );

  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error(
      "GitHub returned an invalid installation token expiry."
    );
  }

  console.log(
    "✓ Repository-scoped installation token issued."
  );

  console.log(
    `  Repository: ${access.repositoryIdentity}`
  );

  console.log(
    `  Expires: ${access.expiresAt}`
  );

  console.log(
    "\n✓ GitHub App authentication boundary passed."
  );
}

main().catch((error) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    "\n✗ GitHub App authentication test failed:"
  );

  console.error(message);

  process.exitCode = 1;
});