import {
  runDockerSandboxCommand,
} from "../src/lib/sandbox/docker-sandbox";

async function main() {
  console.log(
    "\n=== DeployGuard Docker Sandbox ===\n"
  );

  const result =
    await runDockerSandboxCommand({
      repositoryPath:
        process.cwd(),

      command: [
        "node",
        "-e",
        `
          console.log("DeployGuard sandbox active");
          console.log("Node:", process.version);
          console.log("CWD:", process.cwd());
        `,
      ],
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
    "Sandbox test failed:",
    error
  );

  process.exit(1);
});