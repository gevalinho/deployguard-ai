import type {
  RepositoryFact,
} from "@/lib/evidence/types";

export type EnvironmentSensitivity =
  | "public"
  | "secret"
  | "configuration"
  | "unknown";

export interface EnvironmentSensitivityClassification {
  variable: string;

  sensitivity: EnvironmentSensitivity;

  confidence: number;

  reason: string;

  evidence: RepositoryFact["evidence"];
}

const SENSITIVE_PATTERNS = [
  "SECRET",
  "TOKEN",
  "PASSWORD",
  "PRIVATE",
  "API_KEY",
  "DATABASE_URL",
];

function looksSensitive(
  variable: string
): boolean {
  const normalized =
    variable.toUpperCase();

  return SENSITIVE_PATTERNS.some(
    (pattern) =>
      normalized.includes(pattern)
  );
}

function looksExplicitlyPublic(
  variable: string
): boolean {
  return (
    variable.startsWith(
      "NEXT_PUBLIC_"
    ) ||
    variable.startsWith(
      "VITE_PUBLIC_"
    ) ||
    variable.startsWith(
      "PUBLIC_"
    )
  );
}

export function classifyEnvironmentSensitivity(
  facts: RepositoryFact[]
): EnvironmentSensitivityClassification[] {
  return facts
    .filter(
      (fact) =>
        fact.key ===
        "environmentVariable"
    )
    .map(
      (fact) => {
        const variable =
          fact.value;

        const isPublic =
          looksExplicitlyPublic(
            variable
          );

        const isSensitive =
          looksSensitive(
            variable
          );

        /*
         * A variable whose name simultaneously signals
         * public exposure and secret material is unsafe
         * and contradictory.
         *
         * Preserve that uncertainty rather than silently
         * deciding that either signal wins.
         */
        if (
          isPublic &&
          isSensitive
        ) {
          return {
            variable,
            sensitivity: "unknown",
            confidence: 0.5,
            reason:
              "Variable naming contains both public-exposure and sensitive-value signals.",
            evidence: fact.evidence,
          };
        }

        if (isPublic) {
          return {
            variable,
            sensitivity: "public",
            confidence: 0.9,
            reason:
              "Variable naming explicitly indicates public exposure.",
            evidence: fact.evidence,
          };
        }

        if (isSensitive) {
          return {
            variable,
            sensitivity: "secret",
            confidence: 0.9,
            reason:
              "Variable naming indicates potentially sensitive configuration.",
            evidence: fact.evidence,
          };
        }

        return {
          variable,
          sensitivity:
            "configuration",
          confidence: 0.6,
          reason:
            "Variable is configuration without explicit public or sensitive naming evidence.",
          evidence: fact.evidence,
        };
      }
    );
}
