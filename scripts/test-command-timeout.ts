import { runCommand } from "@/lib/execution/command-runner";

async function main() {
  const result =
    await runCommand(
      "node",
      [
        "-e",
        "setTimeout(() => console.log('finished'), 10000)",
      ],
      process.cwd(),
      {
        timeoutMs: 1500,
      }
    );

  console.log(result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});