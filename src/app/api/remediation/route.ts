import {
  runRemoteRemediation,
} from "@/lib/orchestration/remediation-orchestrator";

import type {
  FixProposal,
} from "@/lib/remediation/types";
import { readDeveloperSession, sameOrigin } from "@/lib/auth/developer-session";
import { authorizeDeveloperRepository } from "@/lib/auth/github-developer-auth";
import { parseGitHubRepositoryUrl } from "@/lib/repository/github-repository";
import { openGitHubAppReadTransport } from "@/lib/repository/github-app-read-transport";

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
    value as Record<string, unknown>;

  if (
    !isString(proposal.id) ||
    !isString(proposal.title) ||
    !isString(proposal.description)
  ) {
    return false;
  }

  if (
    proposal.strategy !== "dependency_security" &&
    proposal.strategy !== "lint_autofix"
  ) {
    return false;
  }

  if (
    proposal.risk !== "safe" &&
    proposal.risk !== "breaking_change_allowed"
  ) {
    return false;
  }

  if (
    proposal.packageName !== undefined &&
    !isString(proposal.packageName)
  ) {
    return false;
  }
  if (proposal.advisoryId !== undefined &&
      (typeof proposal.advisoryId !== "string" || !/^[0-9]{1,20}$/.test(proposal.advisoryId))) return false;

  if (
    !proposal.target ||
    typeof proposal.target !== "object"
  ) {
    return false;
  }

  const target =
    proposal.target as Record<string, unknown>;

  if (
    !isNonNegativeIntegerArray(
      target.evidenceIndexes
    )
  ) {
    return false;
  }

  /*
   * Keep strategy and target tightly coupled.
   *
   * A dependency-security proposal may only
   * target the security check.
   *
   * A lint-autofix proposal may only target
   * the lint check.
   */
  if (
    proposal.strategy === "dependency_security"
  ) {
    if (
      target.checkId !== "security" ||
      target.category !== "security"
    ) {
      return false;
    }

    if (!isString(proposal.packageName) || !/^[0-9]{1,20}$/.test(String(proposal.advisoryId)) ||
        target.evidenceIndexes.length !== 1) return false;

    return true;
  }

  if (
    proposal.strategy === "lint_autofix"
  ) {
    if (
      target.checkId !== "lint" ||
      target.category !== "lint"
    ) {
      return false;
    }

    /*
     * packageName has meaning only for
     * dependency-security remediation.
     */
    if (proposal.packageName !== undefined || proposal.advisoryId !== undefined) {
      return false;
    }

    /*
     * Lint autofix is the restricted safe
     * remediation path.
     */
    if (proposal.risk !== "safe") {
      return false;
    }

    return true;
  }

  return false;
}

export async function POST(
  request: Request
) {
  const developer = readDeveloperSession(request);
  if (!developer) return Response.json({ ok: false, error: "Developer sign-in required." }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
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

  // This API accepts assessment/remediation inputs only. Delivery authority and
  // repository provenance cannot be supplied by a client.
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !["repositoryUrl", "proposal"].includes(key))) {
    return Response.json({ ok: false, error: "Only repositoryUrl and proposal are accepted." }, { status: 400 });
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

  let repository;
  try {
    repository = parseGitHubRepositoryUrl(repositoryUrl);
  } catch {
    return Response.json({ ok: false, error: "A valid GitHub repository URL is required." }, { status: 400 });
  }
  let authorized: boolean;
  try {
    authorized = await authorizeDeveloperRepository(developer, repository.fullName);
  } catch {
    return Response.json({ ok: false, error: "Repository authorization could not be verified." }, { status: 503 });
  }
  if (!authorized) return Response.json({ ok: false, error: "Repository remediation is not authorized." }, { status: 403 });

  try {
    const result =
      await runRemoteRemediation(
        repositoryUrl,
        {
          id: body.proposal.id,
          title: body.proposal.title,
          description: body.proposal.description,
          strategy: body.proposal.strategy,
          risk: body.proposal.risk,
          target: {
            checkId: body.proposal.target.checkId,
            category: body.proposal.target.category,
            evidenceIndexes: [...body.proposal.target.evidenceIndexes],
          },
          ...(body.proposal.packageName ? { packageName: body.proposal.packageName } : {}),
          ...(body.proposal.advisoryId ? { advisoryId: body.proposal.advisoryId } : {}),
        },
        openGitHubAppReadTransport,
      );

    return Response.json({
      ok: true,
      remediation: result,
    });
  } catch {
    // Internal errors may contain source, credentials, or workspace paths.
    console.error("[DeployGuard Remediation API] Remediation failed.");

    return Response.json(
      {
        ok: false,
        error: "Remediation could not be completed.",
      },
      {
        status: 422,
      }
    );
  }
}
