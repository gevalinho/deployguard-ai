import "dotenv/config";

import {
  scanRepository,
} from "../src/lib/scanner/repository-scanner";

import {
  runResearchAgent,
} from "../src/lib/agents/research-agent";

async function main() {
  console.log(
    "\n=== DeployGuard Research Agent Test ===\n"
  );

  console.log(
    "Scanning repository..."
  );

  const scan =
    scanRepository(
      process.cwd()
    );

  console.log(
    `Detected ${scan.facts.length} repository facts.`
  );

  console.log(
    "\nGenerating research requirements..."
  );

  const startedAt =
    Date.now();

  const research =
    await runResearchAgent(
      scan
    );

  const durationMs =
    Date.now() - startedAt;

  console.log(
    `Research completed in ${(
      durationMs / 1000
    ).toFixed(2)} seconds.`
  );

  console.log(
    "\nResearch queries:"
  );

  for (
    const query of
    research.queries
  ) {
    console.log(
      `- ${query}`
    );
  }

  const evidence =
    research.results.flatMap(
      (result) =>
        result.evidence
    );

  console.log(
    `\nEvidence items: ${evidence.length}`
  );

  for (
    const item of evidence
  ) {
    console.log(
      [
        "",
        `[${item.source.authority}]`,
        item.topic,
        item.source.url,
        `Relevance: ${
          item.relevanceScore ??
          "unknown"
        }`,
      ].join("\n")
    );
  }
}

main().catch((error) => {
  console.error(
    "\nDeployGuard Research Agent failed:"
  );

  if (error instanceof Error) {
    console.error(
      error.message
    );

    if (error.cause) {
      console.error(
        error.cause
      );
    }
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});