import {
  parseGitHubRepositoryUrl,
} from "../src/lib/repository/github-repository";

import {
  ingestGitHubRepository,
} from "../src/lib/repository/repository-ingestion";

import {
  prepareSandboxWorkspace,
} from "../src/lib/sandbox/workspace-preparation";

import {
  runSandboxBuildAgent,
} from "../src/lib/agents/sandbox-build-agent";

async function main() {
  console.log(
    "\n=== DeployGuard Remote Sandbox Build ===\n"
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
    console.log(
      "\nPreparing dependencies..."
    );

    const preparation =
      await prepareSandboxWorkspace(
        ingested.repositoryPath
      );

    console.log(
      `Preparation: ${preparation.status}`
    );

    if (
      preparation.status !== "passed"
    ) {
      console.log(
        preparation.stderr
      );

      throw new Error(
        "Sandbox preparation failed."
      );
    }

    console.log(
      "\nRunning production build with network disabled..."
    );

    const build =
      await runSandboxBuildAgent(
        ingested.repositoryPath
      );

    console.log(
      "\nBuild result:\n"
    );

    console.log(
      JSON.stringify(
        build,
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
    "\nRemote sandbox build test failed:",
    error
  );

  process.exit(1);
});