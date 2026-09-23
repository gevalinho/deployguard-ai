import {
  runRemoteRemediation,
} from "@/lib/orchestration/remediation-orchestrator";

import type {
  FixProposal,
} from "@/lib/remediation/types";

export const runtime = "nodejs";

interface RemediationRequestBody {
  repositoryUrl?: unknown;
  proposal?: unknown;
}

function isString(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function isNonNegativeIntegerArray(
  value: unknown
): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        Number.isInteger(item) &&
        item >= 0
    )
  );
}

function isFixProposal(
  value: unknown
): value is FixProposal {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return false;
  }

  const proposal =
    value as Record<
      string,
      unknown
    >;

  if (
    !isString(proposal.id) ||
    !isString(proposal.title) ||
    !isString(proposal.description)
  ) {
    return false;
  }

  if (
    proposal.strategy !==
    "dependency_security"
  ) {
    return false;
  }

  if (
    proposal.risk !== "safe" &&
    proposal.risk !==
      "breaking_change_allowed"
  ) {
    return false;
  }

  if (
    proposal.packageName !==
      undefined &&
    !isString(
      proposal.packageName
    )
  ) {
    return false;
  }

  if (
    !proposal.target ||
    typeof proposal.target !==
      "object"
  ) {
    return false;
  }

  const target =
    proposal.target as Record<
      string,
      unknown
    >;

  if (
    target.checkId !==
      "security" ||
    target.category !==
      "security"
  ) {
    return false;
  }

  if (
    !isNonNegativeIntegerArray(
      target.evidenceIndexes
    )
  ) {
    return false;
  }

  return true;
}

export async function POST(
  request: Request
) {
  let body:
    RemediationRequestBody;

  try {
    body =
      (await request.json()) as RemediationRequestBody;
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
    typeof body.repositoryUrl ===
    "string"
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

  if (
    !isFixProposal(
      body.proposal
    )
  ) {
    return Response.json(
      {
        ok: false,
        error:
          "A valid controlled remediation proposal is required.",
      },
      {
        status: 400,
      }
    );
  }

  try {
    const result =
      await runRemoteRemediation(
        repositoryUrl,
        body.proposal
      );

    return Response.json({
      ok: true,
      remediation: result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown remediation error.";

    console.error(
      "[DeployGuard Remediation API]",
      error
    );

    return Response.json(
      {
        ok: false,
        error: message,
      },
      {
        status: 422,
      }
    );
  }
}