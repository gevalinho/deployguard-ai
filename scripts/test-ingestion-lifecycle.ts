import { existsSync } from "node:fs";

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

  const ingested =
    await ingestGitHubRepository(repository);

  console.log({
    repositoryPath:
      ingested.repositoryPath,

    existsBeforeCleanup:
      existsSync(
        ingested.repositoryPath
      ),
  });

  ingested.cleanup();

  console.log({
    existsAfterCleanup:
      existsSync(
        ingested.repositoryPath
      ),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});