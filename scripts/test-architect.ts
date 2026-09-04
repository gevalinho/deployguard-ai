import "dotenv/config";


import { scanRepository } from "@/lib/scanner/repository-scanner";
import { runArchitectAgent } from "@/lib/agents/architect-agent";

async function main() {
  console.log(
    "=== DeployGuard Architect Agent Test ==="
  );

  const repositoryPath =
    process.cwd();

  console.log(
    "Scanning repository..."
  );

  const scan =
    await scanRepository(
      repositoryPath
    );

  console.log(
    `Detected ${scan.facts.length} repository facts.`
  );

  console.log(
    "Running Nemotron Architect Agent..."
  );

  const analysis =
    await runArchitectAgent(scan);

  console.log(
    "\n=== Architecture Analysis ==="
  );

  console.log(
    JSON.stringify(
      analysis,
      null,
      2
    )
  );
}

main().catch((error) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    "\nArchitect Agent failed:"
  );

  console.error(message);

  process.exitCode = 1;
});