import "dotenv/config";

import { runLintAgent } from "../src/lib/agents/lint-agent";
import { runTypecheckAgent } from "../src/lib/agents/typecheck-agent";
import { scanRepository } from "../src/lib/scanner/repository-scanner";

async function main() {
  console.log("\n=== DeployGuard Quality Agents ===\n");

  const scan = scanRepository(process.cwd());

  console.log("Running TypeScript check...\n");
  const typeResult = await runTypecheckAgent(scan);

  console.log(JSON.stringify(typeResult, null, 2));

  console.log("\nRunning lint check...\n");
  const lintResult = await runLintAgent(scan);

  console.log(JSON.stringify(lintResult, null, 2));
}

main().catch((error) => {
  console.error("\nQuality Agents failed:\n");
  console.error(error);
  process.exit(1);
});