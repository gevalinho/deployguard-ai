import "dotenv/config";

import { runBuildAgent } from "../src/lib/agents/build-agent";
import { runLintAgent } from "../src/lib/agents/lint-agent";
import { runTypecheckAgent } from "../src/lib/agents/typecheck-agent";
import { calculateReadinessScore } from "../src/lib/scoring/readiness-score";
import { scanRepository } from "../src/lib/scanner/repository-scanner";

async function main() {
  console.log("\n=== DeployGuard Readiness Score ===\n");

  const scan = scanRepository(process.cwd());

  const buildResult = await runBuildAgent(scan);
  const typeResult = await runTypecheckAgent(scan);
  const lintResult = await runLintAgent(scan);

  const checks = [
    buildResult,
    typeResult,
    lintResult,
  ];

  console.log("Check results:\n");

  for (const check of checks) {
    console.log(
      `${check.name}: ${check.status.toUpperCase()}`
    );
  }

  const readiness = calculateReadinessScore(checks);

  console.log("\nReadiness:");
  console.log(JSON.stringify(readiness, null, 2));
}

main().catch((error) => {
  console.error("\nReadiness scoring failed:\n");
  console.error(error);
  process.exit(1);
});