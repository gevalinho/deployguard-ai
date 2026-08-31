import "dotenv/config";

import { runTestAgent } from "../src/lib/agents/test-agent";
import { scanRepository } from "../src/lib/scanner/repository-scanner";

async function main() {
  console.log("\n=== DeployGuard Test Agent ===\n");

  const scan = scanRepository(process.cwd());

  const testScript = scan.facts.find(
    (fact) => fact.key === "testScript"
  );

  const testFramework = scan.facts.find(
    (fact) => fact.key === "testFramework"
  );

  console.log(
    "Detected test framework:",
    testFramework?.value ?? "none"
  );

  console.log(
    "Detected test script:",
    testScript?.value ?? "none"
  );

  console.log("\nEvaluating test suite...\n");

  const result = await runTestAgent(scan);

  console.log("Test result:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("\nTest Agent failed:\n");
  console.error(error);
  process.exit(1);
});