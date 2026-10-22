export type InterruptionReason =
  | "dependency_registry_unavailable"
  | "dependency_preparation_timeout"
  | "audit_service_unavailable"
  | "approved_build_asset_unavailable"
  | "external_build_dependency_unavailable"
  | "github_unavailable"
  | "sandbox_cleanup_unconfirmed"
  | "assessment_cleanup_unconfirmed"
  | "assessment_deadline_exceeded"
  | "stage_deadline_exceeded"
  | "sandbox_infrastructure_unavailable";

export interface AssessmentInterruption {
  status: "interrupted";
  stage: "repository" | "preparation" | "security" | "build" | "execution" | "authorization" | "scan" | "types" | "lint" | "test" | "report";
  service: "GitHub" | "package registry" | "dependency installation" | "dependency audit service" | "Google Fonts" | "external build dependency" | "Docker sandbox" | "assessment service";
  reason: InterruptionReason;
  retryable: boolean;
  message: string;
}

/** Terminal assessment outcome. Only controlled fields cross the SSE boundary. */
export class AssessmentInterruptedError extends Error {
  readonly outcome: AssessmentInterruption;

  constructor(outcome: Omit<AssessmentInterruption, "status" | "message">) {
    const message = `Assessment interrupted: ${outcome.service} prevented verification during ${outcome.stage}. Production readiness was not scored.${
      outcome.retryable
        ? " Retry Assessment when the service is available."
        : outcome.reason === "sandbox_cleanup_unconfirmed" || outcome.reason === "assessment_cleanup_unconfirmed"
          ? " Contact an operator to reconcile assessment resources before retrying."
        : " Review the repository's external build dependency before retrying."
    }`;
    super(message);
    this.name = "AssessmentInterruptedError";
    this.outcome = { status: "interrupted", ...outcome, message };
  }
}
