import {
  runDockerSandboxCommand,
} from "../src/lib/sandbox/docker-sandbox";

async function main() {
  console.log(
    "\n=== DeployGuard Sandbox Timeout ===\n"
  );

  const result =
    await runDockerSandboxCommand({
      repositoryPath:
        process.cwd(),

      command: [
        "node",
        "-e",
        `
          console.log("Starting long-running process");

          setTimeout(() => {
            console.log("This should never complete");
          }, 30000);
        `,
      ],

      limits: {
        memoryMb: 512,
        cpus: 1,
        timeoutMs: 2000,
      },
    });

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    "Timeout test failed:",
    error
  );

  process.exit(1);
});