import {
  parseGitHubRepositoryUrl,
} from "../src/lib/repository/github-repository";

import {
  ingestGitHubRepository,
} from "../src/lib/repository/repository-ingestion";

import {
  prepareSandboxWorkspace,
} from "../src/lib/sandbox/workspace-preparation";

async function main() {
  console.log(
    "\n=== DeployGuard Sandbox Preparation ===\n"
  );

  const repository =
    parseGitHubRepositoryUrl(
      "https://github.com/gevalinho/deployguard-ai"
    );

  console.log(
    `Repository: ${repository.fullName}`
  );

  const ingested =
    await ingestGitHubRepository(
      repository
    );

  try {
    const result =
      await prepareSandboxWorkspace(
        ingested.repositoryPath
      );

    console.log(
      JSON.stringify(
        result,
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
    "Sandbox preparation test failed:",
    error
  );

  process.exit(1);
});