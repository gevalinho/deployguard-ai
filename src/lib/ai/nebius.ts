import OpenAI from "openai";

export const NEBIUS_MODELS = {
  architect:
    "nvidia/nemotron-3-super-120b-a12b",
} as const;

export const NEMOTRON_ANALYSIS_TIMEOUT_MS = 20_000;
export const NEMOTRON_REMEDIATION_TIMEOUT_MS = 12_000;

export function getNebiusClient(timeoutMs: number): OpenAI {
  const apiKey =
    process.env.NEBIUS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "NEBIUS_API_KEY is missing."
    );
  }

  return new OpenAI({
    apiKey,
    baseURL:
      "https://api.tokenfactory.us-central1.nebius.com/v1/",
    timeout: timeoutMs,
    maxRetries: 0,
  });
}
