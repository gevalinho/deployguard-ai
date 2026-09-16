import type {
  ArchitectureAnalysis,
} from "@/lib/agents/architect-agent";

import type {
  ResearchAgentResult,
} from "@/lib/agents/research-agent";

import {
  verifyArchitectureAnalysis,
} from "@/lib/agents/verifier";

import type {
  RepositoryScanResult,
} from "@/lib/scanner/types";

const scan: RepositoryScanResult = {
  repositoryPath: "/tmp/example-repository",
  scannedAt: new Date().toISOString(),
  facts: [
    {
      key: "framework",
      value: "Next.js",
      confidence: 1,
      evidence: [
        {
          source: "package",
          path: "package.json",
          description:
            "Next.js dependency detected.",
        },
      ],
    },
    {
      key: "frameworkVersion",
      value: "16.3.3",
      confidence: 1,
      evidence: [
        {
          source: "package",
          path: "package.json",
          description:
            "Next.js version detected.",
        },
      ],
    },
  ],
};

const primaryUrl =
  "https://nextjs.org/docs/example";

const secondaryUrl =
  "https://example.com/nextjs-analysis";

const research: ResearchAgentResult = {
  queries: [
    "Next.js 16.3.3 production guidance",
  ],
  results: [
    {
      query:
        "Next.js 16.3.3 production guidance",
      researchedAt:
        new Date().toISOString(),
      evidence: [
        {
          topic:
            "Next.js production guidance",
          excerpt:
            "Example primary-source guidance.",
          relevanceScore: 0.95,
          source: {
            title:
              "Next.js Documentation",
            url: primaryUrl,
            sourceType:
              "official_documentation",
            authority: "primary",
            publisher: "Next.js",
          },
        },
        {
          topic:
            "Next.js commentary",
          excerpt:
            "Example secondary commentary.",
          relevanceScore: 0.8,
          source: {
            title:
              "Secondary Analysis",
            url: secondaryUrl,
            sourceType: "other",
            authority: "secondary",
            publisher: "Example",
          },
        },
      ],
    },
  ],
};

const analysis: ArchitectureAnalysis = {
  summary:
    "Verifier test analysis.",
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
        "Valid repository-supported risk",
      severity: "medium",
      reason:
        "Uses a repository fact that exists.",
      evidenceKeys: [
        "framework",
      ],
      researchUrls: [],
      inference: false,
    },

    {
      title:
        "Fabricated repository evidence",
      severity: "critical",
      reason:
        "References a repository fact that does not exist.",
      evidenceKeys: [
        "completelyFakeFact",
      ],
      researchUrls: [],
      inference: false,
    },

    {
      title:
        "Fabricated research URL",
      severity: "high",
      reason:
        "References external research DeployGuard never supplied.",
      evidenceKeys: [
        "frameworkVersion",
      ],
      researchUrls: [
        "https://fake.example.com/advisory",
      ],
      inference: false,
    },

    {
      title:
        "Inference-only risk",
      severity: "medium",
      reason:
        "The model explicitly marked this as inference.",
      evidenceKeys: [
        "framework",
      ],
      researchUrls: [],
      inference: true,
    },

    {
      title:
        "Secondary-only research risk",
      severity: "high",
      reason:
        "Uses known external evidence but no primary source.",
      evidenceKeys: [
        "frameworkVersion",
      ],
      researchUrls: [
        secondaryUrl,
      ],
      inference: false,
    },

    {
      title:
        "Primary-supported external risk",
      severity: "medium",
      reason:
        "Uses a real repository fact and known primary research.",
      evidenceKeys: [
        "frameworkVersion",
      ],
      researchUrls: [
        primaryUrl,
      ],
      inference: false,
    },
  ],
};

const result =
  verifyArchitectureAnalysis(
    scan,
    analysis,
    research
  );

console.log(
  "\nAccepted risks:"
);

for (
  const risk of result.acceptedRisks
) {
  console.log(
    `✓ ${risk.title}`
  );
}

console.log(
  "\nRejected risks:"
);

for (
  const risk of result.rejectedRisks
) {
  console.log(
    `✓ ${risk.title}`
  );
}

const acceptedTitles =
  new Set(
    result.acceptedRisks.map(
      (risk) => risk.title
    )
  );

const rejectedTitles =
  new Set(
    result.rejectedRisks.map(
      (risk) => risk.title
    )
  );

const expectations = [
  {
    name:
      "real repository evidence accepted",
    passed:
      acceptedTitles.has(
        "Valid repository-supported risk"
      ),
  },
  {
    name:
      "fabricated repository evidence rejected",
    passed:
      rejectedTitles.has(
        "Fabricated repository evidence"
      ),
  },
  {
    name:
      "fabricated research URL rejected",
    passed:
      rejectedTitles.has(
        "Fabricated research URL"
      ),
  },
  {
    name:
      "inference-only risk rejected",
    passed:
      rejectedTitles.has(
        "Inference-only risk"
      ),
  },
  {
    name:
      "secondary-only research rejected",
    passed:
      rejectedTitles.has(
        "Secondary-only research risk"
      ),
  },
  {
    name:
      "primary-supported research accepted",
    passed:
      acceptedTitles.has(
        "Primary-supported external risk"
      ),
  },
];

console.log(
  "\nVerifier assertions:"
);

for (const expectation of expectations) {
  if (expectation.passed) {
    console.log(
      `✓ PASS: ${expectation.name}`
    );
  } else {
    console.error(
      `✕ FAIL: ${expectation.name}`
    );

    process.exitCode = 1;
  }
}

if (
  result.acceptedRisks.length !== 2
) {
  console.error(
    `✕ FAIL: expected 2 accepted risks, received ${result.acceptedRisks.length}.`
  );

  process.exitCode = 1;
}

if (
  result.rejectedRisks.length !== 4
) {
  console.error(
    `✕ FAIL: expected 4 rejected risks, received ${result.rejectedRisks.length}.`
  );

  process.exitCode = 1;
}

if (!process.exitCode) {
  console.log(
    "\n✓ Architecture verifier test completed successfully."
  );
}