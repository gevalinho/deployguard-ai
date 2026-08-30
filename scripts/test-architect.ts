// import "dotenv/config";

// import { runArchitectAgent } from "../src/lib/agents/architect-agent";
// import { scanRepository } from "../src/lib/scanner/repository-scanner";
// import { verifyArchitectureAnalysis } from "../src/lib/agents/verifier";

// async function main() {
//   console.log("\n=== DeployGuard Architect Agent ===\n");

//   const scan = scanRepository(process.cwd());

//   console.log("Verified repository facts:");
//   console.log(JSON.stringify(scan.facts, null, 2));

//   console.log("\nSending verified evidence to Nemotron...\n");

//   const architecture = await runArchitectAgent(scan);

//   const verification = verifyArchitectureAnalysis(scan, architecture);

// console.log("\nVerification:");
// console.log(JSON.stringify(verification, null, 2));

//   console.log("Architecture analysis:");
//   console.log(JSON.stringify(architecture, null, 2));
// }

// main().catch((error) => {
//   console.error("\nArchitect Agent failed:\n");
//   console.error(error);
//   process.exit(1);
// });





import "dotenv/config";

import { runArchitectAgent } from "../src/lib/agents/architect-agent";
import { verifyArchitectureAnalysis } from "../src/lib/agents/verifier";
import { scanRepository } from "../src/lib/scanner/repository-scanner";

async function main() {
  console.log("\n=== DeployGuard Architect Agent ===\n");

  const scan = scanRepository(process.cwd());

  console.log("Verified repository facts:");
  console.log(JSON.stringify(scan.facts, null, 2));

  console.log("\nSending verified evidence to Nemotron...\n");

  const architecture = await runArchitectAgent(scan);

  console.log("Architecture analysis:");
  console.log(JSON.stringify(architecture, null, 2));

  const verification = verifyArchitectureAnalysis(scan, architecture);

  console.log("\nVerification:");
  console.log(JSON.stringify(verification, null, 2));
}

main().catch((error) => {
  console.error("\nArchitect Agent failed:\n");
  console.error(error);
  process.exit(1);
});

