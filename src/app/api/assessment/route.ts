import { runRemoteReadinessAssessment } from "@/lib/orchestration/remote-readiness-orchestrator";
import { AssessmentInterruptedError } from "@/lib/orchestration/assessment-interruption";
import {
  AssessmentDeadlineError,
  createAssessmentExecutionContext,
  runAssessmentStage,
} from "@/lib/orchestration/assessment-execution";
import { AssessmentCancelledError, assertAssessmentTime } from "@/lib/orchestration/assessment-execution";
import { finishAssessment, markAssessmentClientDisconnected, registerAssessment, validAssessmentId } from "@/lib/orchestration/active-assessments";
import { randomUUID } from "node:crypto";

import type { AssessmentProgressEvent } from "@/lib/orchestration/assessment-progress";

import { parseRepositoryEnvironment } from "@/lib/api/repository-environment-input";

import { readDeveloperSession, sameOrigin } from "@/lib/auth/developer-session";

import { authorizeDeveloperRepository } from "@/lib/auth/github-developer-auth";

import { parseGitHubRepositoryUrl } from "@/lib/repository/github-repository";

import { openGitHubAppReadTransport } from "@/lib/repository/github-app-read-transport";

export const runtime = "nodejs";

interface AssessmentRequestBody {
  repositoryUrl?: unknown;
  environment?: unknown;
  assessmentId?: unknown;
}

function encodeSseEvent(event: string, data: unknown): string {
  return [`event: ${event}`, `data: ${JSON.stringify(data)}`, "", ""].join(
    "\n",
  );
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();

  const developer = readDeveloperSession(request);

  if (!developer) {
    return Response.json(
      {
        ok: false,
        error: "Developer sign-in required.",
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  if (!sameOrigin(request)) {
    return Response.json(
      {
        ok: false,
        error: "Invalid request origin.",
      },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  let body: AssessmentRequestBody;

  try {
    body = (await request.json()) as AssessmentRequestBody;
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Request body must contain valid JSON.",
      },
      {
        status: 400,
      },
    );
  }

  const repositoryUrl =
    typeof body.repositoryUrl === "string" ? body.repositoryUrl.trim() : "";

  if (!repositoryUrl) {
    return Response.json(
      {
        ok: false,
        error: "GitHub repository URL is required.",
      },
      {
        status: 400,
      },
    );
  }

  let repository;

  try {
    repository = parseGitHubRepositoryUrl(repositoryUrl);
  } catch {
    return Response.json(
      {
        ok: false,
        error: "A valid GitHub repository URL is required.",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const assessmentId = body.assessmentId === undefined ? randomUUID() : body.assessmentId;
  if (!validAssessmentId(assessmentId)) return Response.json({ ok: false, error: "Invalid assessment ID." },
    { status: 400 });
  const execution = createAssessmentExecutionContext();
  if (!registerAssessment(assessmentId, developer.githubId, execution.cancel)) {
    execution.dispose();
    return Response.json({ ok: false, error: "Assessment ID is already in use." }, { status: 409 });
  }
  let repositoryAuthorized = false;

  try {
    repositoryAuthorized = await execution.run(() =>
      runAssessmentStage("authorization", () =>
        authorizeDeveloperRepository(developer, repository.fullName),
      ),
    );
  } catch (error) {
    execution.dispose();
    if (error instanceof AssessmentCancelledError) {
      finishAssessment(assessmentId, "cancelled");
      return Response.json({ ok: false, code: "ASSESSMENT_CANCELLED", error: "Assessment cancellation confirmed." },
        { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    finishAssessment(assessmentId, "interrupted");

    if (error instanceof AssessmentDeadlineError)
      return Response.json(
        {
          ok: false,
          code: "ASSESSMENT_DEADLINE_EXCEEDED",
          error: "GitHub authorization timed out. Retry Assessment.",
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        },
      );

    console.error(
      "[DeployGuard Assessment] Repository authorization failed.",
      error,
    );

    return Response.json(
      {
        ok: false,
        code: "REPOSITORY_AUTHORIZATION_UNAVAILABLE",
        error: "Repository authorization could not be verified.",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (!repositoryAuthorized) {
    execution.dispose();
    finishAssessment(assessmentId, "failed");
    return Response.json(
      {
        ok: false,
        code: "REPOSITORY_AUTHORIZATION_REQUIRED",
        error: "Repository assessment is not authorized.",
      },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const environmentResult = parseRepositoryEnvironment(body.environment);

  if (!environmentResult.ok) {
    execution.dispose();
    finishAssessment(assessmentId, "failed");
    return Response.json(
      {
        ok: false,
        error: environmentResult.error,
      },
      {
        status: 400,
      },
    );
  }

  /*
   * Repository environment values are execution inputs
   * only. Never include them in SSE events, diagnostics,
   * assessment reports, or server logs.
   */
  const repositoryEnvironment = environmentResult.environment;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;

        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      };

      void execution.run(async () => {
        try {
          send("started", {
            assessmentId,
            repositoryUrl,
            message: "DeployGuard assessment started.",
          });

          const result = await runRemoteReadinessAssessment(repositoryUrl, {
            environment: repositoryEnvironment,
            readTransportFactory: openGitHubAppReadTransport,
            onProgress: async (progress: AssessmentProgressEvent) => {
              send("progress", progress);
            },
          });

          assertAssessmentTime();
          finishAssessment(assessmentId, "completed");

          send("result", {
            ok: true,
            assessment: result,
          });
        } catch (error) {
            if (error instanceof AssessmentInterruptedError &&
                (error.outcome.reason === "sandbox_cleanup_unconfirmed" ||
                  error.outcome.reason === "assessment_cleanup_unconfirmed")) {
              finishAssessment(assessmentId, "cleanup_unconfirmed");
              send("interrupted", { ok: false, ...error.outcome });
              return;
            }
            if (error instanceof AssessmentCancelledError || execution.signal.reason === "user_requested") {
              finishAssessment(assessmentId, "cancelled");
              send("cancelled", { ok: false, status: "cancelled",
                message: "Assessment cancellation confirmed. Production readiness was not scored." });
              return;
            }
          if (error instanceof AssessmentDeadlineError) {
              finishAssessment(assessmentId, "interrupted");
            send("interrupted", {
              ok: false,
              status: "interrupted",
              stage:
                error.stage === "overall" || error.stage === "optional"
                  ? "execution"
                  : error.stage,
              service: "assessment service",
              reason: error.reason,
              retryable: true,
              message:
                "Assessment execution timed out. Production readiness was not scored. Retry Assessment.",
            });
            return;
          }
          if (error instanceof AssessmentInterruptedError) {
              finishAssessment(assessmentId, error.outcome.reason === "sandbox_cleanup_unconfirmed"
                ? "cleanup_unconfirmed" : "interrupted");
            send("interrupted", { ok: false, ...error.outcome });
            return;
          }
          const message =
            error instanceof Error
              ? error.message
              : "Unknown assessment error.";

          console.error("DeployGuard remote assessment failed:", error);
          finishAssessment(assessmentId, "failed");

          send("assessment-error", {
            ok: false,
            error: message,
          });
        } finally {
          close();
          execution.dispose();
        }
      });
    },
      cancel() {
        // A browser disconnect is observable, but does not prove that Docker or
        // child processes stopped. The explicit authenticated endpoint controls cancellation.
        markAssessmentClientDisconnected(assessmentId);
      },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
