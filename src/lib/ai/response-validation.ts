export function parseAiJson(
  content: string
): unknown {
  const trimmed = content.trim();

  if (!trimmed) {
    throw new Error(
      "AI response content is empty."
    );
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // A single complete fenced block may be surrounded by prose. Never
    // extract arbitrary braces or combine multiple candidate objects.
    const fences = [...trimmed.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```/gi)];
    if (fences.length === 1 && !trimmed.replace(fences[0][0], "").includes("```")) {
      try {
        return JSON.parse(fences[0][1].trim());
      } catch { /* Schema and syntax remain strict. */ }
    }
    throw new Error("AI response did not contain valid JSON.");
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
