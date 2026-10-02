import { randomBytes } from "node:crypto";
import { sameOrigin } from "@/lib/auth/developer-session";
import { deliveryApiDependencies, matchesDelivery, publicDelivery, validArtifact, type DeliveryApiDependencies } from "@/lib/remediation/developer-delivery-api";
import { issueGitHubPullRequestCapability, signGitHubPullRequestCapability } from "@/lib/remediation/github-pull-request-capability";
import { createVerifiedGitHubPullRequest } from "@/lib/remediation/github-pull-request-delivery";

export type PullRequestApiDependencies = Pick<DeliveryApiDependencies, "session" | "authorize" | "artifact" | "delivery" | "pr"> & {
  create: typeof createVerifiedGitHubPullRequest;
};
const dependencies: PullRequestApiDependencies = { ...deliveryApiDependencies, create: createVerifiedGitHubPullRequest };
function failure(status: number, code: string, error: string): Response {
  return Response.json({ ok: false, code, error }, { status, headers: { "Cache-Control": "no-store" } });
}
export async function handleDeveloperPullRequestPost(request: Request, deliveryId: string,
  deps: PullRequestApiDependencies = dependencies): Promise<Response> {
  try {
    const developer = deps.session(request);
    if (!developer) return failure(401, "unauthenticated", "Developer sign-in required.");
    if (!sameOrigin(request)) return failure(403, "invalid_origin", "Invalid request origin.");
    let body: unknown;
    try { body = await request.json(); } catch { return failure(400, "invalid_request", "Invalid JSON request."); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 || (body as Record<string, unknown>).confirmPullRequest !== true)
      return failure(400, "invalid_request", "Only explicit pull request confirmation is accepted.");
    if (!/^[a-z0-9]{8,64}$/.test(deliveryId)) return failure(404, "delivery_not_found", "Delivery was not found.");
    const delivery = await deps.delivery(deliveryId);
    if (!delivery || delivery.id !== deliveryId) return failure(404, "delivery_not_found", "Delivery was not found.");
    const artifact = await deps.artifact(delivery.artifactId);
    if (!artifact || !validArtifact(artifact) || !matchesDelivery(delivery, artifact))
      return failure(409, "identity_conflict", "Trusted artifact and delivery identity conflict.");
    if (!await deps.authorize(developer, delivery.repositoryIdentity))
      return failure(403, "unauthorized", "Repository delivery is not authorized.");
    if (delivery.status !== "PUSHED" || !/^[a-f0-9]{40}$/.test(delivery.commitSha ?? ""))
      return failure(409, "invalid_delivery_state", "A verified pushed delivery is required.");
    if (delivery.sourceBranch !== "main")
      return failure(409, "unsupported_base", "Pull requests require the verified main source branch.");

    // Match the delivery handler's lifecycle: fresh 32-byte server-only secret,
    // shared only by issuance and verification within this awaited operation.
    const secret = randomBytes(32).toString("hex");
    const signed = signGitHubPullRequestCapability(issueGitHubPullRequestCapability(
      delivery.repositoryIdentity, delivery.id, artifact.sha256, delivery.branchName,
      delivery.commitSha!, delivery.sourceBranch, delivery.originalHead,
    ), secret);
    const result = await deps.create(delivery.repositoryIdentity, delivery.id, signed, secret,
      "Verified DeployGuard remediation", "Controlled remediation independently verified by DeployGuard AI.");
    if (result.status !== "created" && result.status !== "already_exists") {
      const unavailable = ["github_auth_failed", "base_branch_lookup_failed", "head_branch_lookup_failed",
        "pull_request_preflight_failed", "persistence_failed", "pull_request_failed"].includes(result.status);
      return failure(unavailable ? 503 : 409, result.status,
        "Pull request was not verified. Refresh delivery status; conflicts or uncertain attempts require recovery review.");
    }
    // Only persisted verified identity may be exposed, never an unpersisted POST response.
    const pr = await deps.pr(delivery.id);
    const safe = publicDelivery(delivery, pr);
    if (!safe.pullRequest || pr?.deliveryId !== delivery.id)
      return failure(503, "persistence_failed", "Verified pull request status could not be recovered.");
    return Response.json({ ok: true, outcome: result.status, delivery: safe }, {
      status: result.status === "created" ? 201 : 200, headers: { "Cache-Control": "no-store" },
    });
  } catch { return failure(503, "unavailable", "Pull request could not be completed safely; refresh status before recovery review."); }
}
