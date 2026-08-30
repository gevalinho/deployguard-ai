import "dotenv/config";
import OpenAI from "openai";

const apiKey = process.env.NEBIUS_API_KEY;

if (!apiKey) {
  throw new Error("NEBIUS_API_KEY is missing.");
}

const client = new OpenAI({
  apiKey,
  baseURL: "https://api.tokenfactory.us-central1.nebius.com/v1/",
});

async function main() {
  const packageJson = {
    name: "sample-store",
    private: true,
    scripts: {
      build: "next build",
      test: "vitest",
      lint: "next lint",
    },
    dependencies: {
      next: "^15.0.0",
      react: "^19.0.0",
      "@prisma/client": "^6.0.0",
      "next-auth": "^5.0.0",
    },
    devDependencies: {
      typescript: "^5.0.0",
      prisma: "^6.0.0",
      vitest: "^3.0.0",
    },
  };

  const response = await client.chat.completions.create({
    model: "nvidia/nemotron-3-super-120b-a12b",

    messages: [
      {
        role: "system",
        content: `
You are the repository architecture analyst for DeployGuard AI.

Analyze software project metadata and identify its technology stack.

Return ONLY valid JSON matching this structure:

{
  "framework": string | null,
  "language": string | null,
  "packageManager": string | null,
  "database": string | null,
  "orm": string | null,
  "authentication": string | null,
  "testFramework": string | null,
  "recommendedChecks": string[]
}
        `.trim(),
      },
      {
        role: "user",
        content: `
Analyze this package.json:

${JSON.stringify(packageJson, null, 2)}
        `.trim(),
      },
    ],

    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("Nemotron returned no content.");
  }

  console.log("\n=== DeployGuard Nemotron Test ===\n");
  console.log(content);
}

main().catch((error) => {
  console.error("\nNemotron test failed:\n");
  console.error(error);
  process.exit(1);
});
