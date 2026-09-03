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
  runSandboxSecurityAgent,
} from "../src/lib/agents/sandbox-security-agent";

async function main() {
  console.log(
    "\n=== DeployGuard Remote Sandbox Security ===\n"
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
      "\nRunning dependency security audit...\n"
    );

    const security =
      await runSandboxSecurityAgent(
        ingested.repositoryPath
      );

    console.log(
      JSON.stringify(
        security,
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
    "\nRemote sandbox security test failed:",
    error
  );

  process.exit(1);
});