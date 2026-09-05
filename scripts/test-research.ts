import "dotenv/config";

import {
  researchTopic,
} from "../src/lib/research/tavily";

async function main() {
  console.log(
    "\n=== DeployGuard Research Test ===\n"
  );

  const query =
    "Next.js 16 current support status and security guidance";

  console.log(
    `Research query: ${query}`
  );

  console.log(
    "Running Tavily research...\n"
  );

  const startedAt =
    Date.now();

  const result =
    await researchTopic(query);

  const durationMs =
    Date.now() - startedAt;

  console.log(
    `Research completed in ${(
      durationMs / 1000
    ).toFixed(2)} seconds.\n`
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  console.log(
  `\nEvidence items: ${result.evidence.length}`
);
}

main().catch((error) => {
  console.error(
    "\nDeployGuard research test failed:"
  );

  if (error instanceof Error) {
    console.error(
      `Message: ${error.message}`
    );

    if (error.cause) {
      console.error(
        "\nUnderlying cause:"
      );

      console.error(
        error.cause
      );
    }

    console.error(
      "\nFull error:"
    );

    console.error(error);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});