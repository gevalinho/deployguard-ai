import "dotenv/config";

import { runEnvironmentAgent } from "../src/lib/agents/environment-agent";
import { scanRepository } from "../src/lib/scanner/repository-scanner";

async function main() {
  console.log("\n=== DeployGuard Environment Agent ===\n");

  const scan = scanRepository(process.cwd());

  console.log("Inspecting environment configuration safely...\n");

  const result = await runEnvironmentAgent(scan);

  console.log("Environment result:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("\nEnvironment Agent failed:\n");
  console.error(error);
  process.exit(1);
});