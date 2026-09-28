
import {
  ingestGitHubRepository,
} from "@/lib/repository/repository-ingestion";

import {
  parseGitHubRepositoryUrl,
} from "@/lib/repository/github-repository";

async function main(): Promise<void> {
  const repository =
    parseGitHubRepositoryUrl(
  "https://github.com/gevalinho/deployguard-ai"
);

  console.log(
    "Testing repository ingestion provenance..."
  );

  const ingested =
    await ingestGitHubRepository(
      repository,
      (message) => {
        console.log(
          `[Progress] ${message}`
        );
      }
    );

  try {
    console.log(
      "\nRepository:",
      ingested.repository.fullName
    );

    console.log(
      "Path:",
      ingested.repositoryPath
    );

    console.log(
      "Provenance:",
      JSON.stringify(
        ingested.provenance,
        null,
        2
      )
    );
  } finally {
    ingested.cleanup();
  }

  console.log(
    "\n✓ Repository ingestion completed"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});