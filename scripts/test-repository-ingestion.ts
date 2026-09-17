// import {
//   parseGitHubRepositoryUrl,
// } from "../src/lib/repository/github-repository";

// import {
//   ingestGitHubRepository,
// } from "../src/lib/repository/repository-ingestion";

// async function main() {
//   const repository =
//     parseGitHubRepositoryUrl(
//       "https://github.com/gevalinho/deployguard-ai"
//     );

//   console.log(
//     "\n=== DeployGuard Repository Ingestion Test ===\n"
//   );

//   console.log(
//     `Repository: ${repository.fullName}`
//   );

//   console.log(
//     "Starting repository ingestion..."
//   );

//   const startedAt = Date.now();

//   const ingested =
//     await ingestGitHubRepository(
//       repository
//     );

//   const durationMs =
//     Date.now() - startedAt;

//   try {
//     console.log(
//       "\nRepository ingestion succeeded."
//     );

//     console.log(
//       `Repository path: ${ingested.repositoryPath}`
//     );

//     console.log(
//       `Ingestion time: ${(durationMs / 1000).toFixed(2)} seconds`
//     );
//   } finally {
//     ingested.cleanup();

//     console.log(
//       "Temporary repository removed."
//     );
//   }
// }

// main().catch((error) => {
//   const message =
//     error instanceof Error
//       ? error.message
//       : String(error);

//   console.error(
//     "\nRepository ingestion failed:"
//   );

//   console.error(message);

//   process.exitCode = 1;
// });


import {
  ingestGitHubRepository,
} from "@/lib/repository/repository-ingestion";

import {
  parseGitHubRepositoryUrl,
} from "@/lib/repository/github-repository";

async function main(): Promise<void> {
  const repository =
    parseGitHubRepositoryUrl(
      "https://github.com/aashikvilla/nextjs-unit-tests"
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