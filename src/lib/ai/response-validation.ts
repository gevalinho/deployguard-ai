export function parseAiJson(
  content: string
): unknown {
  const trimmed = content.trim();

  if (!trimmed) {
    throw new Error(
      "AI response content is empty."
    );
  }

  /*
   * Models occasionally wrap otherwise valid JSON
   * inside Markdown code fences.
   *
   * Remove only the outer fence. The resulting
   * content must still pass JSON.parse normally.
   */
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    throw new Error(
      "AI response did not contain valid JSON."
    );
  }
}

export function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function isStringArray(
  value: unknown
): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => typeof item === "string"
    )
  );
}

export function isNumberArray(
  value: unknown
): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "number" &&
        Number.isInteger(item)
    )
  );
}