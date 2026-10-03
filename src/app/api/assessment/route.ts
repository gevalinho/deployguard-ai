import {
  runRemoteReadinessAssessment,
} from "@/lib/orchestration/remote-readiness-orchestrator";

import type {
  AssessmentProgressEvent,
} from "@/lib/orchestration/assessment-progress";

import {
  parseRepositoryEnvironment,
} from "@/lib/api/repository-environment-input";

export const runtime = "nodejs";

interface AssessmentRequestBody {
  repositoryUrl?: unknown;
  environment?: unknown;
}

function encodeSseEvent(
  event: string,
  data: unknown
): string {
  return [
    `event: ${event}`,
    `data: ${JSON.stringify(data)}`,
    "",
    "",
  ].join("\n");
}

export async function POST(
  request: Request
) {
  const encoder =
    new TextEncoder();

  let body: AssessmentRequestBody;

  try {
    body =
      (await request.json()) as AssessmentRequestBody;
  } catch {
    return Response.json(
      {
        ok: false,
        error:
          "Request body must contain valid JSON.",
      },
      {
        status: 400,
      }
    );
  }

  const repositoryUrl =
    typeof body.repositoryUrl === "string"
      ? body.repositoryUrl.trim()
      : "";

  if (!repositoryUrl) {
    return Response.json(
      {
        ok: false,
        error:
          "GitHub repository URL is required.",
      },
      {
        status: 400,
      }
    );
  }

  const environmentResult =
    parseRepositoryEnvironment(
      body.environment
    );

  if (!environmentResult.ok) {
    return Response.json(
      {
        ok: false,
        error:
          environmentResult.error,
      },
      {
        status: 400,
      }
    );
  }

  /*
   * Repository environment values are execution inputs
   * only. Never include them in SSE events, diagnostics,
   * assessment reports, or server logs.
   */
  const repositoryEnvironment =
    environmentResult.environment;

  const stream =
    new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;

        const send = (
          event: string,
          data: unknown
        ) => {
          if (closed) {
            return;
          }

          try {
            controller.enqueue(
              encoder.encode(
                encodeSseEvent(
                  event,
                  data
                )
              )
            );
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

        void (async () => {
          try {
            send(
              "started",
              {
                repositoryUrl,
                message:
                  "DeployGuard assessment started.",
              }
            );

            const result =
              await runRemoteReadinessAssessment(
                repositoryUrl,
                {
                  environment:
                    repositoryEnvironment,
                  onProgress: async (
                    progress:
                      AssessmentProgressEvent
                  ) => {
                    send(
                      "progress",
                      progress
                    );
                  },
                }
              );

            send(
              "result",
              {
                ok: true,
                assessment: result,
              }
            );
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Unknown assessment error.";

            console.error(
              "DeployGuard remote assessment failed:",
              error
            );

            send(
              "assessment-error",
              {
                ok: false,
                error: message,
              }
            );
          } finally {
            close();
          }
        })();
      },
    });

  return new Response(
    stream,
    {
      status: 200,
      headers: {
        "Content-Type":
          "text/event-stream; charset=utf-8",
        "Cache-Control":
          "no-cache, no-transform",
        Connection:
          "keep-alive",
        "X-Accel-Buffering":
          "no",
      },
    }
  );
}