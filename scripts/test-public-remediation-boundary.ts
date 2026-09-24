import {
  sanitizeRemediationForPublic,
} from "@/lib/remediation/public-remediation";

import type {
  RemediationRun,
} from "@/lib/remediation/types";

const secret =
  "DEPLOYGUARD_SECRET_SENTINEL";

  const sourceSecret =
  "DEPLOYGUARD_SOURCE_SECRET_SENTINEL";

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

        readinessImpact: {
      before: {
        score: 67,
        coverage: 30,

        earnedWeight: 20,
        evaluatedWeight: 30,
        applicableWeight: 100,
        totalWeight: 100,

        passed: 1,
        failed: 1,
        blocked: 0,
        skipped: 0,
        errors: 0,
        totalChecks: 2,

        readinessGaps: [
          "security",
        ],

        unevaluatedCategories: [
          "build",
          "types",
          "lint",
          "database",
          "deployment",
          "environment",
        ],

        notApplicableCategories: [],
      },

      after: {
        score: 100,
        coverage: 30,

        earnedWeight: 30,
        evaluatedWeight: 30,
        applicableWeight: 100,
        totalWeight: 100,

        passed: 2,
        failed: 0,
        blocked: 0,
        skipped: 0,
        errors: 0,
        totalChecks: 2,

        readinessGaps: [],

        unevaluatedCategories: [
          "build",
          "types",
          "lint",
          "database",
          "deployment",
          "environment",
        ],

        notApplicableCategories: [],
      },

      scoreDelta: 33,
      coverageDelta: 0,

      improved: true,

      resolvedGaps: [
        "security",
      ],

      introducedGaps: [],
    },
  },

  verifiedPatch: {
  fileCount: 2,

  files: [
    {
      path: "package.json",
      changeType: "modified",

      before:
        `{"dependency":"old","secret":"${sourceSecret}"}`,

      after:
        `{"dependency":"fixed","secret":"${sourceSecret}"}`,
    },

    {
      path: "package-lock.json",
      changeType: "modified",

      before:
        `old lockfile ${sourceSecret}`,

      after:
        `new lockfile ${sourceSecret}`,
    },
  ],
},

verifiedPatchArtifact: {
  format: "unified_diff",

  content:
    `diff --git a/package.json b/package.json
-${sourceSecret}
+safe replacement
`,

  byteSize: 123,

  sha256:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
},

};

const publicResult =
  sanitizeRemediationForPublic(
    remediation
  );

const serialized =
  JSON.stringify(publicResult);

if (
  serialized.includes(sourceSecret)
) {
  throw new Error(
    "Verified patch artifact content crossed the public remediation boundary."
  );
}

if (
  serialized.includes(
    '"content"'
  )
) {
  throw new Error(
    "Verified patch artifact content field crossed the public remediation boundary."
  );
}

if (
  publicResult
    .verifiedPatchArtifact
    ?.format !== "unified_diff"
) {
  throw new Error(
    "Verified patch artifact format was not preserved."
  );
}

if (
  publicResult
    .verifiedPatchArtifact
    ?.byteSize !== 123
) {
  throw new Error(
    "Verified patch artifact byte size was not preserved."
  );
}

if (
  publicResult
    .verifiedPatchArtifact
    ?.sha256 !==
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
) {
  throw new Error(
    "Verified patch artifact SHA-256 was not preserved."
  );
}


  if (
  serialized.includes(
    sourceSecret
  )
) {
  throw new Error(
    "Raw verified patch source content crossed the public remediation boundary."
  );
}


const publicPatchFiles =
  publicResult.verifiedPatch?.files ?? [];

for (const file of publicPatchFiles) {
  if (
    "before" in file ||
    "after" in file
  ) {
    throw new Error(
      "Raw before/after fields crossed the verified patch public boundary."
    );
  }
}




if (
  publicResult.verifiedPatch
    ?.fileCount !== 2
) {
  throw new Error(
    "Verified patch file count was not preserved."
  );
}

if (
  publicResult.verifiedPatch
    .files[0]?.path !==
    "package.json" ||
  publicResult.verifiedPatch
    .files[0]?.changeType !==
    "modified"
) {
  throw new Error(
    "Safe verified patch metadata was not preserved."
  );
}


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

if (
  publicResult.proof
    ?.readinessImpact
    ?.scoreDelta !== 33
) {
  throw new Error(
    "Readiness impact was not preserved across the public remediation boundary."
  );
}

if (
  publicResult.proof
    ?.readinessImpact
    ?.resolvedGaps[0] !==
  "security"
) {
  throw new Error(
    "Resolved readiness gaps were not preserved."
  );
}


console.log(
  "✓ deterministic readiness impact preserved."
);

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

console.log(
  "✓ verified patch source content excluded."
);

console.log(
  "✓ safe verified patch metadata preserved."
);

console.log(
  "✓ verified artifact content excluded."
);

console.log(
  "✓ verified artifact metadata preserved."
);

console.log(
  "✓ verified artifact SHA-256 preserved."
);