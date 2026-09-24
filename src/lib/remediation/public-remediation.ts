import type {
  PublicCheckResult,
} from "@/lib/reporting/types";

import {
  sanitizeCheckForPublic,
} from "@/lib/reporting/public-report";

import type {
  FixExecutionResult,
  FixProof,
  FixProposal,
  RemediationRun,
} from "@/lib/remediation/types";

export type PublicFixExecutionResult =
  Pick<
    FixExecutionResult,
    "status" | "summary" | "durationMs" | "evidence"
  >;

export interface PublicVerificationComparison {
  checkId: string;

  before: PublicCheckResult;
  after: PublicCheckResult;

  improved: boolean;
}

export interface PublicFixProof {
  status: FixProof["status"];
  summary: string;

  comparisons:
    PublicVerificationComparison[];

  regressionChecks:
    PublicCheckResult[];

  readinessImpact?:
    FixProof["readinessImpact"];
}

export interface PublicRemediationRun {
  proposal: FixProposal;

  execution:
    PublicFixExecutionResult;

  proof?: PublicFixProof;
}

export function sanitizeRemediationForPublic(
  remediation: RemediationRun
): PublicRemediationRun {
  const execution:
    PublicFixExecutionResult = {
      status:
        remediation.execution.status,

      summary:
        remediation.execution.summary,

      ...(remediation.execution
        .durationMs !== undefined
        ? {
            durationMs:
              remediation.execution
                .durationMs,
          }
        : {}),

      ...(remediation.execution
        .evidence &&
      remediation.execution
        .evidence.length > 0
        ? {
            evidence:
              remediation.execution
                .evidence,
          }
        : {}),
    };

  const proof =
    remediation.proof
      ? {
          status:
            remediation.proof.status,

          summary:
            remediation.proof.summary,

          comparisons:
            remediation.proof.comparisons.map(
              (comparison) => ({
                checkId:
                  comparison.checkId,

                before:
                  sanitizeCheckForPublic(
                    comparison.before
                  ),

                after:
                  sanitizeCheckForPublic(
                    comparison.after
                  ),

                improved:
                  comparison.improved,
              })
            ),

          regressionChecks:
            remediation.proof
              .regressionChecks.map(
                sanitizeCheckForPublic
              ),
                        ...(remediation.proof
            .readinessImpact
            ? {
                readinessImpact:
                  remediation.proof
                    .readinessImpact,
              }
            : {}),
        }
      : undefined;

  return {
    proposal:
      remediation.proposal,

    execution,

    ...(proof
      ? {
          proof,
        }
      : {}),
  };
}