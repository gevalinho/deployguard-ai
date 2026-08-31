import "dotenv/config";

import { runSecurityAgent } from "../src/lib/agents/security-agent";
import { scanRepository } from "../src/lib/scanner/repository-scanner";

async function main() {
  console.log("\n=== DeployGuard Security Agent ===\n");

  const scan = scanRepository(process.cwd());

  console.log("Running dependency security audit...\n");

  const result = await runSecurityAgent(scan);

  console.log("Security result:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("\nSecurity Agent failed:\n");
  console.error(error);
  process.exit(1);
});