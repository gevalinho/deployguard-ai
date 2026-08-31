import { loadEnvConfig } from "@next/env";
import { runReadinessAssessment } from "../src/lib/orchestration/readiness-orchestrator";

loadEnvConfig(process.cwd());

async function main() {
  console.log(
    "\n=== DeployGuard Readiness Orchestrator ===\n"
  );

  const report = await runReadinessAssessment(
    process.cwd()
  );

  console.log(
    JSON.stringify(report, null, 2)
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});