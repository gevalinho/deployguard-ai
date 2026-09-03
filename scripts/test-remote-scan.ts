import {
  parseGitHubRepositoryUrl,
} from "../src/lib/repository/github-repository";

import {
  ingestGitHubRepository,
} from "../src/lib/repository/repository-ingestion";

import {
  scanRepository,
} from "../src/lib/scanner/repository-scanner";

async function main() {
  console.log(
    "\n=== DeployGuard Remote Repository Scan ===\n"
  );

  const repository =
    parseGitHubRepositoryUrl(
      "https://github.com/gevalinho/deployguard-ai"
    );

  console.log(
    `Repository: ${repository.fullName}`
  );

  const ingested =
    await ingestGitHubRepository(repository);

  try {
    const scan = scanRepository(
      ingested.repositoryPath
    );

    console.log(
      JSON.stringify(
        scan,
        null,
        2
      )
    );
  } finally {
    ingested.cleanup();

    console.log(
      "\nTemporary repository removed."
    );
  }
}

main().catch((error) => {
  console.error(
    "Remote scan failed:",
    error
  );

  process.exit(1);
});