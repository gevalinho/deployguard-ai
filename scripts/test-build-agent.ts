import "dotenv/config";

import { runBuildAgent } from "../src/lib/agents/build-agent";
import { scanRepository } from "../src/lib/scanner/repository-scanner";

async function main() {
  console.log("\n=== DeployGuard Build Agent ===\n");

  const scan = scanRepository(process.cwd());

  console.log("Detected package manager:");

  const packageManager = scan.facts.find(
    (fact) => fact.key === "packageManager"
  );

  console.log(packageManager?.value ?? "unknown");

  console.log("\nRunning production build...\n");

  const result = await runBuildAgent(scan);

  console.log("Build result:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("\nBuild Agent failed:\n");
  console.error(error);
  process.exit(1);
});