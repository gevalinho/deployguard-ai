import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";

export type NemotronResult = "success" | "generation_truncated" | "invalid_json" | "schema_invalid" | "deadline" |
  "sdk_timeout" | "provider_http_error" | "network_error" | "unknown_error";

type Usage = ChatCompletion["usage"];

export function classifyNemotronError(error: unknown, signal?: AbortSignal): NemotronResult {
  if (signal?.aborted) return "deadline";
  if (error instanceof Error && (error.message === "AI response did not contain valid JSON." || error.message === "AI response content is empty.")) return "invalid_json";
  if (error instanceof Error && error.message.startsWith("AI ") && error.message.includes("response")) return "schema_invalid";
  if (error instanceof OpenAI.APIConnectionTimeoutError) return "sdk_timeout";
  if (error instanceof OpenAI.APIError && typeof error.status === "number") return "provider_http_error";
  if (error instanceof OpenAI.APIConnectionError) return "network_error";
  return "unknown_error";
}

export function emitNemotronTelemetry(data: {
  agent: "architecture" | "remediation";
  model: string;
  durationMs: number;
  requestChars: number;
  usage?: Usage;
  finishReason?: string | null;
  responseChars?: number;
  result: NemotronResult;
}): void {
  const details = data.usage?.completion_tokens_details as
    | { reasoning_tokens?: number } | undefined;
  console.info("[DeployGuard Nemotron]", JSON.stringify({
    agent: data.agent,
    model: data.model,
    durationMs: data.durationMs,
    requestChars: data.requestChars,
    prompt_tokens: data.usage?.prompt_tokens ?? null,
    completion_tokens: data.usage?.completion_tokens ?? null,
    reasoning_tokens: details?.reasoning_tokens ?? null,
    total_tokens: data.usage?.total_tokens ?? null,
    finish_reason: data.finishReason ?? null,
    responseChars: data.responseChars ?? null,
    result: data.result,
  }));
}

export async function runObservedNemotron<T>(options: {
  agent: "architecture" | "remediation";
  model: string;
  requestChars: number;
  signal?: AbortSignal;
  request: () => Promise<ChatCompletion>;
  parse: (content: string) => T;
}): Promise<T> {
  const started = performance.now();
  let usage: Usage | undefined;
  let finishReason: string | null | undefined;
  let responseChars: number | undefined;
  let recorded = false;
  const record = (result: NemotronResult) => {
    if (recorded) return;
    recorded = true;
    emitNemotronTelemetry({
      agent: options.agent, model: options.model,
      durationMs: Math.round(performance.now() - started),
      requestChars: options.requestChars, usage, finishReason, responseChars, result,
    });
  };
  const onAbort = () => record("deadline");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await options.request();
    usage = response.usage;
    finishReason = response.choices[0]?.finish_reason;
    const content = response.choices[0]?.message?.content;
    responseChars = content?.length ?? 0;
    if (finishReason === "length") {
      record("generation_truncated");
      throw new Error("AI generation ended before completion.");
    }
    if (!content) throw new Error("AI response content is empty.");
    const value = options.parse(content);
    record("success");
    return value;
  } catch (error) {
    record(classifyNemotronError(error, options.signal));
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}
