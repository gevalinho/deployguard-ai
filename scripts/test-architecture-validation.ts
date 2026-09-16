import {
  validateArchitectureAnalysis,
} from "@/lib/ai/architecture-validation";

function expectValid(
  name: string,
  value: unknown
): void {
  try {
    const result =
      validateArchitectureAnalysis(value);

    console.log(`✓ PASS: ${name}`);
    console.log(
      `  Accepted ${result.risks.length} risk(s).`
    );
  } catch (error) {
    console.error(`✕ FAIL: ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function expectInvalid(
  name: string,
  value: unknown
): void {
  try {
    validateArchitectureAnalysis(value);

    console.error(
      `✕ FAIL: ${name} was incorrectly accepted.`
    );

    process.exitCode = 1;
  } catch (error) {
    console.log(`✓ PASS: ${name}`);
    console.log(
      `  Rejected: ${
        error instanceof Error
          ? error.message
          : "Unknown validation error."
      }`
    );
  }
}

expectValid(
  "valid architecture response",
  {
    summary:
      "The repository uses Next.js and TypeScript.",
    architectureType:
      "Next.js web application",
    recommendedChecks: [
      "TypeScript",
      "Lint",
      "Tests",
      "Production Build",
    ],
    risks: [
      {
        title:
          "Example evidence-supported risk",
        severity: "medium",
        reason:
          "The supplied evidence supports further verification.",
        evidenceKeys: [
          "framework",
        ],
        researchUrls: [],
        inference: false,
      },
    ],
  }
);

expectValid(
  "valid response with no risks",
  {
    summary:
      "No supported architecture risks were identified.",
    architectureType:
      "Next.js web application",
    recommendedChecks: [
      "TypeScript",
      "Production Build",
    ],
    risks: [],
  }
);

expectInvalid(
  "non-object response",
  "not an object"
);

expectInvalid(
  "numeric summary",
  {
    summary: 123,
    architectureType: "Next.js",
    recommendedChecks: [],
    risks: [],
  }
);

expectInvalid(
  "missing architectureType",
  {
    summary: "Summary",
    recommendedChecks: [],
    risks: [],
  }
);

expectInvalid(
  "recommendedChecks is not string array",
  {
    summary: "Summary",
    architectureType: "Next.js",
    recommendedChecks: [
      "Build",
      123,
    ],
    risks: [],
  }
);

expectInvalid(
  "invalid risk severity",
  {
    summary: "Summary",
    architectureType: "Next.js",
    recommendedChecks: [],
    risks: [
      {
        title: "Risk",
        severity: "extreme",
        reason: "Reason",
        evidenceKeys: [],
        researchUrls: [],
        inference: false,
      },
    ],
  }
);

expectInvalid(
  "invalid evidenceKeys",
  {
    summary: "Summary",
    architectureType: "Next.js",
    recommendedChecks: [],
    risks: [
      {
        title: "Risk",
        severity: "high",
        reason: "Reason",
        evidenceKeys: [
          "framework",
          42,
        ],
        researchUrls: [],
        inference: false,
      },
    ],
  }
);

expectInvalid(
  "invalid researchUrls",
  {
    summary: "Summary",
    architectureType: "Next.js",
    recommendedChecks: [],
    risks: [
      {
        title: "Risk",
        severity: "high",
        reason: "Reason",
        evidenceKeys: [],
        researchUrls: [
          "https://example.com",
          42,
        ],
        inference: false,
      },
    ],
  }
);

expectInvalid(
  "invalid inference type",
  {
    summary: "Summary",
    architectureType: "Next.js",
    recommendedChecks: [],
    risks: [
      {
        title: "Risk",
        severity: "high",
        reason: "Reason",
        evidenceKeys: [],
        researchUrls: [],
        inference: "false",
      },
    ],
  }
);

/*
 * IMPORTANT:
 *
 * This should pass STRUCTURAL validation.
 *
 * The evidence verifier — not this validator —
 * is responsible for determining whether these
 * references actually exist.
 */
expectValid(
  "structurally valid fabricated references",
  {
    summary:
      "Structurally valid but not yet evidence verified.",
    architectureType:
      "Next.js web application",
    recommendedChecks: [
      "Security",
    ],
    risks: [
      {
        title:
          "Fabricated evidence example",
        severity: "critical",
        reason:
          "This deliberately uses references that the contract validator cannot verify.",
        evidenceKeys: [
          "completelyFakeFact",
        ],
        researchUrls: [
          "https://fake.example.com/advisory",
        ],
        inference: false,
      },
    ],
  }
);