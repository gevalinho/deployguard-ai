import { runDeploymentAgent } from "../src/lib/agents/deployment-agent";
import { scanRepository } from "../src/lib/scanner/repository-scanner";

async function main() {
  console.log("\n=== DeployGuard Deployment Agent ===\n");

  const scan = scanRepository(process.cwd());

  const deploymentFacts = scan.facts.filter(
    (fact) =>
      fact.key === "deployment" ||
      fact.key === "ci"
  );

  console.log(
    "Detected deployment evidence:",
    deploymentFacts.length > 0
      ? deploymentFacts.map(
          (fact) => `${fact.key}:${fact.value}`
        )
      : "none"
  );

  console.log("\nEvaluating deployment readiness...\n");

  const result = await runDeploymentAgent(scan);

  console.log("Deployment result:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});