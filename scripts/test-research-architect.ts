import "dotenv/config";

import {
  scanRepository,
} from "../src/lib/scanner/repository-scanner";

import {
  runResearchAgent,
} from "../src/lib/agents/research-agent";

import {
  runArchitectAgent,
} from "../src/lib/agents/architect-agent";

import {
  verifyArchitectureAnalysis,
} from "../src/lib/agents/verifier";

async function main() {
  console.log(
    "\n=== DeployGuard Research + Architect Test ===\n"
  );

  console.log(
    "1. Scanning repository..."
  );

  const scan =
    scanRepository(
      process.cwd()
    );

  console.log(
    `   Detected ${scan.facts.length} repository facts.`
  );

  console.log(
    "\n2. Researching external evidence..."
  );

  const researchStartedAt =
    Date.now();

  const research =
    await runResearchAgent(
      scan
    );

  console.log(
    `   Research completed in ${(
      (Date.now() -
        researchStartedAt) /
      1000
    ).toFixed(2)} seconds.`
  );

  const evidence =
    research.results.flatMap(
      (result) =>
        result.evidence
    );

  console.log(
    `   Evidence items: ${evidence.length}`
  );

  console.log(
    "\n3. Running Nemotron Architect Agent..."
  );

  const architectStartedAt =
    Date.now();

  const architecture =
    await runArchitectAgent(
      scan,
      research
    );

  console.log(
    `   Nemotron completed in ${(
      (Date.now() -
        architectStartedAt) /
      1000
    ).toFixed(2)} seconds.`
  );

  console.log(
    "\n=== Architecture Analysis ==="
  );

  console.log(
    JSON.stringify(
      architecture,
      null,
      2
    )
  );

  console.log(
    "\n4. Verifying Nemotron evidence references..."
  );

  const verification =
    verifyArchitectureAnalysis(
      scan,
      architecture,
      research
    );

  console.log(
    `   Accepted risks: ${verification.acceptedRisks.length}`
  );

  console.log(
    `   Rejected risks: ${verification.rejectedRisks.length}`
  );

  if (
    verification.acceptedRisks.length >
    0
  ) {
    console.log(
      "\n=== Verified Risks ==="
    );

    console.log(
      JSON.stringify(
        verification.acceptedRisks,
        null,
        2
      )
    );
  }

  if (
    verification.rejectedRisks.length >
    0
  ) {
    console.log(
      "\n=== Rejected Risks ==="
    );

    console.log(
      JSON.stringify(
        verification.rejectedRisks,
        null,
        2
      )
    );
  }

  console.log(
    "\n=== Evidence Chain ==="
  );

  for (
    const item of evidence
  ) {
    console.log(
      [
        `[${item.source.authority}]`,
        item.source.title,
        item.source.url,
        "",
      ].join("\n")
    );
  }
}

main().catch((error) => {
  console.error(
    "\nDeployGuard integration test failed:"
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