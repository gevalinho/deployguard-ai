import "dotenv/config";

import { runBuildAgent } from "../src/lib/agents/build-agent";
import { runLintAgent } from "../src/lib/agents/lint-agent";
import { runTypecheckAgent } from "../src/lib/agents/typecheck-agent";
import { calculateReadinessScore } from "../src/lib/scoring/readiness-score";
import { scanRepository } from "../src/lib/scanner/repository-scanner";
import { runTestAgent } from "../src/lib/agents/test-agent";
import { runSecurityAgent } from "../src/lib/agents/security-agent";
import { runEnvironmentAgent } from "../src/lib/agents/environment-agent";
import { runDatabaseAgent } from "../src/lib/agents/database-agent";
import { runDeploymentAgent } from "../src/lib/agents/deployment-agent";

async function main() {
  console.log("\n=== DeployGuard Readiness Score ===\n");

  const scan = scanRepository(process.cwd());

  const buildResult = await runBuildAgent(scan);
  const typeResult = await runTypecheckAgent(scan);
  const lintResult = await runLintAgent(scan);
  const testResult = await runTestAgent(scan);
  const securityResult = await runSecurityAgent(scan);
  const environmentResult = await runEnvironmentAgent(scan);
  const databaseResult = await runDatabaseAgent(scan);
  const deploymentResult = await runDeploymentAgent(scan);

  const checks = [
    buildResult,
    typeResult,
    lintResult,
    testResult,
    securityResult,
    environmentResult,
    databaseResult,
    deploymentResult,
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