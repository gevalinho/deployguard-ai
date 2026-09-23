import {
  sanitizeRemediationForPublic,
} from "@/lib/remediation/public-remediation";

import type {
  RemediationRun,
} from "@/lib/remediation/types";

const secret =
  "DEPLOYGUARD_SECRET_SENTINEL";

const remediation: RemediationRun = {
  proposal: {
    id: "security-fix",
    title: "Security fix",
    description:
      "Test remediation boundary.",

    target: {
      checkId: "security",
      category: "security",
      evidenceIndexes: [0],
    },

    strategy:
      "dependency_security",

    risk:
      "breaking_change_allowed",

    packageName: "lodash",
  },

  execution: {
    status: "applied",
    summary:
      "Remediation attempt completed.",

    command:
      `dangerous-command ${secret}`,

    exitCode: 0,

    durationMs: 100,
  },

  proof: {
    status: "proven",
    summary:
      "Security finding removed.",

    comparisons: [
      {
        checkId: "security",

        before: {
          id: "security",
          category: "security",
          name:
            "Dependency Security",
          status: "failed",
          summary:
            "Vulnerability detected.",

          stdout:
            `before stdout ${secret}`,

          stderr:
            `before stderr ${secret}`,

          evidence: [
            {
              kind:
                "security_finding",
              message:
                "lodash vulnerability",
            },
          ],
        },

        after: {
          id: "security",
          category: "security",
          name:
            "Dependency Security",
          status: "passed",
          summary:
            "No vulnerability detected.",

          stdout:
            `after stdout ${secret}`,

          stderr:
            `after stderr ${secret}`,
        },

        improved: true,
      },
    ],

    regressionChecks: [
      {
        id: "test",
        category: "test",
        name: "Tests",
        status: "passed",
        summary:
          "Tests passed.",

        stdout:
          `test stdout ${secret}`,

        stderr:
          `test stderr ${secret}`,
      },
    ],
  },
};

const publicResult =
  sanitizeRemediationForPublic(
    remediation
  );

const serialized =
  JSON.stringify(publicResult);

if (
  serialized.includes(secret)
) {
  throw new Error(
    "Sensitive raw remediation output crossed the public boundary."
  );
}

if (
  serialized.includes(
    '"stdout"'
  ) ||
  serialized.includes(
    '"stderr"'
  )
) {
  throw new Error(
    "stdout/stderr crossed the public remediation boundary."
  );
}

if (
  serialized.includes(
    '"command"'
  )
) {
  throw new Error(
    "The remediation execution command crossed the public boundary."
  );
}

if (
  publicResult.proof?.status !==
  "proven"
) {
  throw new Error(
    "Safe remediation proof data was not preserved."
  );
}

if (
  publicResult.proof
    .comparisons[0]
    ?.before.evidence?.[0]
    ?.message !==
  "lodash vulnerability"
) {
  throw new Error(
    "Structured security evidence was not preserved."
  );
}

console.log(
  "✓ Public remediation boundary passed."
);

console.log(
  "✓ stdout/stderr excluded."
);

console.log(
  "✓ execution command excluded."
);

console.log(
  "✓ structured proof evidence preserved."
);