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
    "\n=== DeployGuard Repository Ingestion ===\n"
  );

  console.log(
    `Repository: ${repository.fullName}`
  );

  const ingested =
    await ingestGitHubRepository(repository);

  try {
    console.log(
      `Cloned to: ${ingested.repositoryPath}`
    );

    console.log(
      "\nRepository ingestion succeeded."
    );
  } finally {
    ingested.cleanup();

    console.log(
      "Temporary repository removed."
    );
  }
}

main().catch((error) => {
  console.error(
    "Repository ingestion failed:",
    error
  );

  process.exit(1);
});