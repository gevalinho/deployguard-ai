import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CheckResult,
} from "@/lib/checks/types";

import type {
  ProductionReadinessReport,
} from "@/lib/reporting/types";

import {
  sanitizeCheckForPublic,
  sanitizeReportForPublic,
} from "@/lib/reporting/public-report";

describe(
  "sanitizeCheckForPublic",
  () => {
    it("preserves numeric security advisory evidence without raw audit output", () => {
      const check: CheckResult = {
        id: "security", category: "security", name: "Dependency Security", status: "failed",
        summary: "High-risk findings", stdout: "private audit output", stderr: "private registry detail",
        evidence: [{ kind: "security_finding", code: "high",
          message: "braces has a high-severity dependency vulnerability.",
          advisoryIds: ["1098094", "1240992"] }],
      };
      const sanitized = sanitizeCheckForPublic(check);
      expect(sanitized.evidence?.[0].advisoryIds).toEqual(["1098094", "1240992"]);
      expect(sanitized).not.toHaveProperty("stdout");
      expect(sanitized).not.toHaveProperty("stderr");
    });
    it(
      "exposes configuration requirements without leaking execution values",
      () => {
        const secret =
          "repository-scoped-super-secret";

        /*
         * Simulate an internal build result containing
         * sensitive execution diagnostics.
         *
         * The secret may exist internally in raw output,
         * but it must never cross the public reporting
         * boundary.
         */
        const check: CheckResult = {
          id: "build",
          category: "build",
          name: "Production Build",
          status: "blocked",
          command: "npm run build",
          summary:
            "Production build requires repository configuration.",

          stdout:
            `internal output: ${secret}`,

          stderr:
            `internal error: ${secret}`,

          evidence: [
            {
              kind: "diagnostic",
              message:
                "BUILD_SECRET requires an explicit repository-scoped value.",
            },
          ],

          configurationRequirements: [
            {
              variable: "BUILD_SECRET",
              phase: "build",
              reason:
                "BUILD_SECRET requires an explicit repository-scoped value for build verification.",
            },
          ],
        };

        const publicCheck =
          sanitizeCheckForPublic(check);

        expect(
          publicCheck.configurationRequirements
        ).toEqual([
          {
            variable: "BUILD_SECRET",
            phase: "build",
            reason:
              "BUILD_SECRET requires an explicit repository-scoped value for build verification.",
          },
        ]);

        expect(
          "stdout" in publicCheck
        ).toBe(false);

        expect(
          "stderr" in publicCheck
        ).toBe(false);

        /*
         * Defense-in-depth assertion:
         * even serialized public output must not contain
         * the sensitive execution value.
         */
        expect(
          JSON.stringify(publicCheck)
        ).not.toContain(secret);
      }
    );

    it(
      "omits configurationRequirements when none exist",
      () => {
        const check: CheckResult = {
          id: "types",
          category: "types",
          name: "TypeScript",
          status: "passed",
          summary:
            "TypeScript verification passed.",
        };

        const publicCheck =
          sanitizeCheckForPublic(check);

        expect(
          "configurationRequirements" in
            publicCheck
        ).toBe(false);
      }
    );
  }
);

describe(
  "sanitizeReportForPublic",
  () => {
    it(
      "preserves configuration requirements without leaking internal execution values",
      () => {
        const secret =
          "full-report-repository-secret";

        const check: CheckResult = {
          id: "build",
          category: "build",
          name: "Production Build",
          status: "blocked",
          command: "npm run build",
          summary:
            "Production build requires repository configuration.",

          stdout:
            `sensitive stdout: ${secret}`,

          stderr:
            `sensitive stderr: ${secret}`,

          evidence: [
            {
              kind: "diagnostic",
              message:
                "BUILD_SECRET requires explicit repository configuration.",
            },
          ],

          configurationRequirements: [
            {
              variable: "BUILD_SECRET",
              phase: "build",
              reason:
                "BUILD_SECRET requires an explicit repository-scoped value for build verification.",
            },
          ],
        };

        const report:
          ProductionReadinessReport = {
            generatedAt:
              "2026-10-03T00:00:00.000Z",

            repository: {
              path:
                "/tmp/deployguard-test-repository",
              scannedAt:
                "2026-10-03T00:00:00.000Z",
              facts: [],
            },

            checks: [
              check,
            ],

            readiness: {
              score: 0,
              coverage: 0,
              earnedWeight: 0,
              evaluatedWeight: 0,
              applicableWeight: 100,
              totalWeight: 100,

              breakdown: [],
              passed: 0,
              failed: 0,
              blocked: 1,
              skipped: 0,
              errors: 0,
              totalChecks: 1,
              readinessGaps: [],
              unevaluatedCategories: [
                "build",
              ],
              notApplicableCategories: [],
            },

            remediation: [],
          };

        const publicReport =
          sanitizeReportForPublic(
            report
          );

        expect(
          publicReport.checks
        ).toHaveLength(1);

        expect(
          publicReport.checks[0]
            .configurationRequirements
        ).toEqual([
          {
            variable: "BUILD_SECRET",
            phase: "build",
            reason:
              "BUILD_SECRET requires an explicit repository-scoped value for build verification.",
          },
        ]);

        expect(
          "stdout" in
            publicReport.checks[0]
        ).toBe(false);

        expect(
          "stderr" in
            publicReport.checks[0]
        ).toBe(false);

        const serialized =
          JSON.stringify(
            publicReport
          );

        expect(
          serialized
        ).not.toContain(secret);

        expect(
          serialized
        ).toContain(
          "BUILD_SECRET"
        );
      }
    );
  }
);

