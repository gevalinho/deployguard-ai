import { validateRemediationAnalysis } from "@/lib/ai/remediation-validation";

function expectValid(
  name: string,
  value: unknown
): void {
  try {
    const result =
      validateRemediationAnalysis(value);

    console.log(`✓ PASS: ${name}`);
    console.log(
      `  Accepted ${result.actions.length} action(s).`
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
    validateRemediationAnalysis(value);

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

expectValid("valid remediation response", {
  summary:
    "Two verified checks require remediation.",
  actions: [
    {
      title: "Resolve TypeScript diagnostic",
      explanation:
        "The captured diagnostic identifies a type error.",
      recommendation:
        "Inspect the referenced TypeScript diagnostic and correct the incompatible type.",
      priority: "high",
      checkId: "types",
      evidenceIndexes: [0],
    },
  ],
});

expectValid("valid empty remediation", {
  summary:
    "No remediation actions are required.",
  actions: [],
});

expectInvalid(
  "non-object response",
  "not an object"
);

expectInvalid(
  "numeric summary",
  {
    summary: 123,
    actions: [],
  }
);

expectInvalid(
  "actions is not an array",
  {
    summary: "Invalid actions.",
    actions: "trust me",
  }
);

expectInvalid(
  "invalid priority",
  {
    summary: "Invalid priority.",
    actions: [
      {
        title: "Fix issue",
        explanation: "Explanation",
        recommendation: "Recommendation",
        priority: "urgent",
        checkId: "types",
        evidenceIndexes: [0],
      },
    ],
  }
);

expectInvalid(
  "invalid evidence index type",
  {
    summary: "Invalid evidence.",
    actions: [
      {
        title: "Fix issue",
        explanation: "Explanation",
        recommendation: "Recommendation",
        priority: "high",
        checkId: "types",
        evidenceIndexes: ["zero"],
      },
    ],
  }
);

expectInvalid(
  "fractional evidence index",
  {
    summary: "Invalid evidence.",
    actions: [
      {
        title: "Fix issue",
        explanation: "Explanation",
        recommendation: "Recommendation",
        priority: "high",
        checkId: "types",
        evidenceIndexes: [1.5],
      },
    ],
  }
);

expectInvalid(
  "missing checkId",
  {
    summary: "Missing check reference.",
    actions: [
      {
        title: "Fix issue",
        explanation: "Explanation",
        recommendation: "Recommendation",
        priority: "high",
        evidenceIndexes: [0],
      },
    ],
  }
);