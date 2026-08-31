import "dotenv/config";

import { runDatabaseAgent } from "../src/lib/agents/database-agent";
import { scanRepository } from "../src/lib/scanner/repository-scanner";

async function main() {
  console.log("\n=== DeployGuard Database Agent ===\n");

  const scan = scanRepository(process.cwd());

  const orm = scan.facts.find(
    (fact) => fact.key === "orm"
  );

  console.log(
    "Detected ORM:",
    orm?.value ?? "none"
  );

  console.log("\nEvaluating database readiness...\n");

  const result = await runDatabaseAgent(scan);

  console.log("Database result:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("\nDatabase Agent failed:\n");
  console.error(error);
  process.exit(1);
});