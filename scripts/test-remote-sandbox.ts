import {
  parseGitHubRepositoryUrl,
} from "../src/lib/repository/github-repository";

import {
  ingestGitHubRepository,
} from "../src/lib/repository/repository-ingestion";

import {
  runDockerSandboxCommand,
} from "../src/lib/sandbox/docker-sandbox";

async function main() {
  console.log(
    "\n=== DeployGuard Remote Sandbox ===\n"
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
      await runDockerSandboxCommand({
        repositoryPath:
          ingested.repositoryPath,

        command: [
          "node",
          "-e",
          `
            const fs = require("node:fs");

            const packageJson =
              JSON.parse(
                fs.readFileSync(
                  "package.json",
                  "utf8"
                )
              );

            console.log(
              JSON.stringify(
                {
                  name:
                    packageJson.name,
                  version:
                    packageJson.version,
                  scripts:
                    Object.keys(
                      packageJson.scripts ?? {}
                    ),
                },
                null,
                2
              )
            );
          `,
        ],

        limits: {
          memoryMb: 512,
          cpus: 1,
          timeoutMs: 30000,
        },
      });

    console.log(
      "\nSandbox result:\n"
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
    "Remote sandbox test failed:",
    error
  );

  process.exit(1);
});