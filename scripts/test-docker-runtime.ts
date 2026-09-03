import {
  getDockerRuntimeStatus,
} from "../src/lib/sandbox/docker-runtime";

async function main() {
  console.log(
    "\n=== DeployGuard Docker Runtime ===\n"
  );

  const status =
    await getDockerRuntimeStatus();

  console.log(
    JSON.stringify(
      status,
      null,
      2
    )
  );

  if (!status.available) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "Docker runtime test failed:",
    error
  );

  process.exit(1);
});