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
  runSandboxTypecheckAgent,
} from "../src/lib/agents/sandbox-typecheck-agent";

import {
  runSandboxLintAgent,
} from "../src/lib/agents/sandbox-lint-agent";

import {
  runSandboxTestAgent,
} from "../src/lib/agents/sandbox-test-agent";

async function main() {
  console.log(
    "\n=== DeployGuard Remote Sandbox Checks ===\n"
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
      throw new Error(
        preparation.stderr ||
        preparation.summary
      );
    }

    console.log(
      "\nRunning sandbox checks with network disabled...\n"
    );

    const [
      types,
      lint,
      tests,
    ] = await Promise.all([
      runSandboxTypecheckAgent(
        ingested.repositoryPath
      ),

      runSandboxLintAgent(
        ingested.repositoryPath
      ),

      runSandboxTestAgent(
        ingested.repositoryPath
      ),
    ]);

    console.log(
      JSON.stringify(
        {
          types,
          lint,
          tests,
        },
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
    "\nRemote sandbox checks failed:",
    error
  );

  process.exit(1);
});