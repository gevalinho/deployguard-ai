import { researchTopic } from "@/lib/research/tavily";

async function main(): Promise<void> {
  console.log(
    "Testing Tavily research..."
  );

  const startedAt =
    Date.now();

  try {
    const result =
      await researchTopic(
        "Next.js current production guidance"
      );

    const durationMs =
      Date.now() - startedAt;

    console.log(
      `✓ Tavily request completed in ${durationMs}ms`
    );

    console.log(
      `✓ Query: ${result.query}`
    );

    console.log(
      `✓ Evidence items: ${result.evidence.length}`
    );

    for (
      const item of result.evidence
    ) {
      console.log(
        `  - ${item.source.authority}: ${item.source.title}`
      );
    }
  } catch (error) {
    console.error(
      "✕ Tavily test failed:"
    );

    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    process.exitCode = 1;
  }
}

void main();