import {
  parseGitHubRepositoryUrl,
} from "../src/lib/repository/github-repository";

import {
  ingestGitHubRepository,
} from "../src/lib/repository/repository-ingestion";

async function main() {
  const repository =
    parseGitHubRepositoryUrl(
      "https://github.com/gevalinho/deployguard-ai"
    );

  console.log(
    "\n=== DeployGuard Repository Ingestion Test ===\n"
  );

  console.log(
    `Repository: ${repository.fullName}`
  );

  console.log(
    "Starting repository ingestion..."
  );

  const startedAt = Date.now();

  const ingested =
    await ingestGitHubRepository(
      repository
    );

  const durationMs =
    Date.now() - startedAt;

  try {
    console.log(
      "\nRepository ingestion succeeded."
    );

    console.log(
      `Repository path: ${ingested.repositoryPath}`
    );

    console.log(
      `Ingestion time: ${(durationMs / 1000).toFixed(2)} seconds`
    );
  } finally {
    ingested.cleanup();

    console.log(
      "Temporary repository removed."
    );
  }
}

main().catch((error) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    "\nRepository ingestion failed:"
  );

  console.error(message);

  process.exitCode = 1;
});