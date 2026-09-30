import { randomBytes } from "node:crypto";
import { readDeveloperSession, sameOrigin, type DeveloperSession } from "@/lib/auth/developer-session";
import { authorizeDeveloperRepository } from "@/lib/auth/github-developer-auth";
import { matchesVerifiedArtifactProvenance, isRemotelyVerifiedIngestionSource } from "@/lib/remediation/artifact-delivery-reference";
import { claimDeveloperDelivery, attachClaimedDelivery, type ClaimResult } from "@/lib/remediation/developer-delivery-claim";
import { createDeveloperDeliveryWorkspace, verifyCurrentRepositoryProvenance, validDeliverySourceBranch, type DeliveryWorkspace } from "@/lib/remediation/developer-delivery-workspace";
import { getVerifiedArtifactMetadata, type TrustedArtifactMetadata } from "@/lib/remediation/trusted-artifact-repository";
import { getRemediationDelivery, type RemediationDeliveryMetadata } from "@/lib/remediation/remediation-delivery-repository";
import { getDurablePullRequestDelivery, type DurablePullRequestDelivery } from "@/lib/remediation/github-pull-request-repository";
import { preparePersistedRemediationDelivery, commitPersistedRemediationDelivery, pushPersistedRemediationDelivery } from "@/lib/remediation/remediation-delivery-pipeline";
import { githubRemoteMatches } from "@/lib/remediation/github-app-git-transport";
import { createRemediationBranchName } from "@/lib/remediation/git-delivery";

export interface DeliveryApiDependencies {
  session: (request: Request) => DeveloperSession | null;
  authorize: typeof authorizeDeveloperRepository;
  artifact: typeof getVerifiedArtifactMetadata;
  claim: typeof claimDeveloperDelivery;
  attach: typeof attachClaimedDelivery;
  workspace: typeof createDeveloperDeliveryWorkspace;
  reverify: typeof verifyCurrentRepositoryProvenance;
  delivery: typeof getRemediationDelivery;
  pr: typeof getDurablePullRequestDelivery;
  prepare: typeof preparePersistedRemediationDelivery;
  commit: typeof commitPersistedRemediationDelivery;
  push: typeof pushPersistedRemediationDelivery;
}
export const deliveryApiDependencies: DeliveryApiDependencies = {
  session: readDeveloperSession, authorize: authorizeDeveloperRepository,
  artifact: getVerifiedArtifactMetadata, claim: claimDeveloperDelivery,
  attach: attachClaimedDelivery, workspace: createDeveloperDeliveryWorkspace,
  reverify: verifyCurrentRepositoryProvenance, delivery: getRemediationDelivery,
  pr: getDurablePullRequestDelivery, prepare: preparePersistedRemediationDelivery,
  commit: commitPersistedRemediationDelivery, push: pushPersistedRemediationDelivery,
};
function error(status: number, code: string): Response {
  return Response.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
}
function publicDelivery(delivery: RemediationDeliveryMetadata, pr?: DurablePullRequestDelivery | null) {
  const result: Record<string, unknown> = {
    artifactId: delivery.artifactId, deliveryId: delivery.id,
    repositoryIdentity: delivery.repositoryIdentity, status: delivery.status,
    branchName: delivery.branchName, commitSha: delivery.commitSha,
    pushedAt: delivery.pushedAt?.toISOString() ?? null,
  };
  if (pr?.status === "VERIFIED" && pr.repositoryIdentity === delivery.repositoryIdentity &&
      pr.provider === "github" && Number.isInteger(pr.prNumber) &&
      pr.prUrl === `https://github.com/${delivery.repositoryIdentity}/pull/${pr.prNumber}` &&
      ["open", "closed"].includes(pr.prState ?? "")) {
    result.pullRequest = { number: pr.prNumber, url: pr.prUrl, state: pr.prState };
  }
  return result;
}
function validArtifact(artifact: TrustedArtifactMetadata): boolean {
  return githubRemoteMatches(artifact.repositoryIdentity, `https://github.com/${artifact.repositoryIdentity}.git`) &&
    artifact.ingestionRemoteVerified === true && isRemotelyVerifiedIngestionSource(artifact.ingestionSource) &&
    /^[a-f0-9]{40}$/.test(artifact.sourceCommitSha ?? "") &&
    typeof artifact.sourceBranch === "string" && validDeliverySourceBranch(artifact.sourceBranch) &&
    /^[a-f0-9]{64}$/.test(artifact.sha256) && artifact.format === "unified_diff";
}
function matchesDelivery(delivery: RemediationDeliveryMetadata, artifact: TrustedArtifactMetadata): boolean {
  return delivery.artifactId === artifact.id && delivery.repositoryIdentity === artifact.repositoryIdentity &&
    delivery.originalHead === artifact.sourceCommitSha && delivery.sourceBranch === artifact.sourceBranch &&
    delivery.branchName === createRemediationBranchName(artifact.sha256) &&
    (delivery.status === "PREPARED" || delivery.status === "FAILED" || Boolean(delivery.commitSha)) &&
    (delivery.status !== "PUSHED" || (delivery.remoteName === "origin" && Boolean(delivery.pushedAt)));
}
async function respondExisting(result: ClaimResult, artifact: TrustedArtifactMetadata): Promise<Response> {
  if (result.kind === "pending") return error(409, "Delivery is in progress or requires explicit recovery.");
  if (result.kind !== "existing" || !matchesDelivery(result.delivery, artifact)) return error(409, "Delivery identity conflict.");
  return Response.json({ ok: true, delivery: publicDelivery(result.delivery) }, { headers: { "Cache-Control": "no-store" } });
}
export async function handleDeveloperDeliveryPost(request: Request, deps: DeliveryApiDependencies = deliveryApiDependencies): Promise<Response> {
  try {
    const developer = deps.session(request);
    if (!developer) return error(401, "Developer sign-in required.");
    if (!sameOrigin(request)) return error(403, "Invalid request origin.");
    let body: unknown;
    try { body = await request.json(); } catch { return error(400, "Invalid JSON request."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return error(400, "Invalid delivery request.");
    const input = body as Record<string, unknown>;
    if (Object.keys(input).length !== 2 || Object.keys(input).some((key) => !["artifactId", "confirmDelivery"].includes(key)) ||
        typeof input.artifactId !== "string" || !/^[a-z0-9]{8,64}$/.test(input.artifactId) || input.confirmDelivery !== true)
      return error(400, "Only artifactId and explicit delivery confirmation are accepted.");
    const artifact = await deps.artifact(input.artifactId);
    if (!artifact || !validArtifact(artifact)) return error(404, "Eligible verified artifact was not found.");
    if (!await deps.authorize(developer, artifact.repositoryIdentity)) return error(403, "Repository delivery is not authorized.");
    const claim = await deps.claim(artifact.id, artifact.repositoryIdentity, developer.githubId);
    if (claim.kind !== "acquired") return respondExisting(claim, artifact);
    let workspace: DeliveryWorkspace | null = null;
    try {
      workspace = await deps.workspace(artifact);
      if (!matchesVerifiedArtifactProvenance(artifact, workspace.provenance))
        return error(409, "Verified repository provenance changed.");
      const secret = randomBytes(32).toString("hex");
      const prepared = await deps.prepare(workspace.path, artifact.repositoryIdentity, artifact.id, secret, workspace.provenance);
      if (prepared.status !== "prepared" || !prepared.delivery || !matchesDelivery(prepared.delivery, artifact))
        return error(409, "Delivery preparation failed; recovery review is required.");
      if (!await deps.attach(artifact.id, artifact.repositoryIdentity, prepared.delivery.id))
        return error(409, "Delivery persistence is uncertain; recovery review is required.");
      const committed = await deps.commit(workspace.path, artifact.repositoryIdentity, prepared.delivery.id, secret);
      if (committed.status !== "committed" || !committed.delivery || !matchesDelivery(committed.delivery, artifact))
        return error(409, "Delivery commit is uncertain; recovery review is required.");
      if (!await deps.reverify(artifact)) return error(409, "Remote source branch changed; recovery review is required.");
      const pushed = await deps.push(workspace.path, artifact.repositoryIdentity, prepared.delivery.id, "origin", secret);
      if (pushed.status !== "pushed" || !pushed.delivery || !matchesDelivery(pushed.delivery, artifact))
        return error(409, "Delivery push is uncertain; recovery review is required.");
      return Response.json({ ok: true, delivery: publicDelivery(pushed.delivery) }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } finally { await workspace?.cleanup(); }
  } catch { return error(503, "Delivery could not be completed safely."); }
}
export async function handleDeveloperDeliveryGet(request: Request, deliveryId: string,
  deps: DeliveryApiDependencies = deliveryApiDependencies): Promise<Response> {
  try {
    const developer = deps.session(request);
    if (!developer) return error(401, "Developer sign-in required.");
    if (!/^[a-z0-9]{8,64}$/.test(deliveryId)) return error(404, "Delivery was not found.");
    const delivery = await deps.delivery(deliveryId);
    if (!delivery) return error(404, "Delivery was not found.");
    const artifact = await deps.artifact(delivery.artifactId);
    if (!artifact || !validArtifact(artifact) || !matchesDelivery(delivery, artifact)) return error(409, "Delivery identity conflict.");
    if (!await deps.authorize(developer, delivery.repositoryIdentity)) return error(403, "Repository delivery is not authorized.");
    const pr = await deps.pr(delivery.id);
    return Response.json({ ok: true, delivery: publicDelivery(delivery, pr) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return error(503, "Delivery status is unavailable."); }
}
