# Verified artifact reference and explicit delivery boundary

The remediation endpoint remains assessment-only with respect to Git delivery:
trusted ingestion → controlled fix in a disposable workspace → independent proof
and regression checks → artifact persistence → cleanup. It does not call prepare,
commit, push, or PR creation. A persistence failure returns no artifact reference.

The existing response envelope is preserved. The only new public field is:

```json
{
  "ok": true,
  "remediation": {
    "repository": {
      "owner": "owner",
      "name": "repo",
      "fullName": "owner/repo",
      "url": "https://github.com/owner/repo"
    },
    "remediation": {
      "verifiedArtifactReference": {
        "artifactId": "opaque-durable-artifact-id"
      }
    }
  }
}
```

The example omits existing proposal, execution, proof, and safe patch metadata.
The reference appears only after proven remediation is persisted. It is an
identifier for evidence, not authorization or a promise that delivery is allowed.
The public sanitizer copies only `artifactId`; patch content, provenance,
capabilities, credentials, and filesystem paths are not added to the response.
API input is limited to repositoryUrl and proposal. Proposal fields are projected
explicitly; nested extra fields cannot supply trusted provenance. Internal errors
are not reflected in public error responses.

## Durable provenance

Artifacts now retain sourceCommitSha, sourceBranch, ingestionSource, and
ingestionRemoteVerified from trusted ingestion. These fields are written with
the artifact in the same database operation. No client values supply them.

Archive ingestion observes remote HEAD first and downloads the archive at that
immutable SHA. Clone fallback checks local HEAD and source branch against the
remote observation. Cache metadata records the fetched content's identity rather
than a later remote HEAD. Old caches without this content binding cannot become
verified-cache authority. TTL and stale fallback remain usable for assessment,
but keep remoteVerified false.

Preparation requires both persisted and newly ingested provenance to be remotely
verified, with an eligible ingestion source and matching source commit/branch.
It independently checks local Git HEAD and branch before branch creation or patch
application. Missing, legacy, TTL, stale, unverified, or mismatched provenance is
denied before Git preparation. Stored provenance is evidence, never standing
permission to mutate Git. Existing artifacts are not retroactively promoted by
the migration's default false value; repeat remediation with verified ingestion
when a deliverable artifact is required.

## Authenticated explicit delivery API

`POST /api/remediation/delivery` accepts exactly `{ "artifactId": "...",
"confirmDelivery": true }`. It requires a signed developer session, same-origin
request, eligible persisted artifact, and fresh GitHub repository authorization.
The server owns repository identity, provenance, artifact hashes, branch names,
commit SHAs, installation tokens, and capabilities. Browser-supplied authority
is rejected. The artifact ID identifies evidence; it is not authorization.

A durable artifact claim serializes delivery attempts. The server independently
re-ingests and clones a clean Git checkout, checks exact source provenance,
prepares the deterministic remediation branch, commits, rechecks remote source
provenance, and pushes the exact commit without force. Independent remote ref
verification precedes persistence of PUSHED. Temporary workspaces are cleaned up.
Duplicate requests return existing state or require recovery; they never silently
restart an uncertain mutation. A moved source requires new verified remediation.

`GET /api/remediation/delivery/[deliveryId]` authenticates and freshly authorizes
repository access. It exposes safe delivery state and, when present, the durable
PR phase (CLAIMED / POST_ATTEMPTED / VERIFIED). Only VERIFIED PR records expose a
canonical GitHub link. For an already VERIFIED PR, status refresh performs a
GitHub GET for the recorded repository and PR number using a read-scoped
installation token. Repository, URL, branch names, and exact remediation commit
must still match. Current base HEAD equality is not required for this status-only
path because a merge advances the base and may delete the remediation branch;
creation-time HEAD checks remain unchanged.

GitHub's state and merged flag determine open, closed without merge, or merged.
Only successful identity verification and persistence return a refreshed state.
A conditional update prevents stale concurrent refreshes overwriting a newer
observation. Failed reads or writes return an error; the dashboard retains and
labels the last known state as stale. CLAIMED and POST_ATTEMPTED records keep their
existing recovery behavior. Refresh never creates, pushes, merges, or retries a
mutation.

## Explicit pull request API

`POST /api/remediation/delivery/[deliveryId]/pull-request` accepts ONLY
`{ "confirmPullRequest": true }`. Every extra field is rejected, including
repository, artifact hash, branches, commits, base SHA, token, capability,
provenance, and title/body. The handler authenticates the developer, checks same
origin, loads the trusted artifact/delivery relationship, freshly authorizes the
repository, and requires a PUSHED delivery on its deterministic remediation branch.
The existing base policy requires `main`.

Only after those checks does the server issue and HMAC-sign a five-minute PR
capability entirely from persisted state. It follows the delivery handler's
secret lifecycle: a fresh random 32-byte secret shared only by issuance and
verification within the server operation. No secret is persisted or returned.
Title and body are server-generated.

The existing PR engine independently verifies both GitHub branch HEADs against
the persisted original base and remediation commit, checks the capability, and
owns durable claims and POST attempts. It verifies existing open/closed PRs,
GET-verifies created PRs, and persists identity before reporting success. A lost
POST response can be reconciled, but POST_ATTEMPTED never authorizes another
POST. Uncertain outcomes remain fail-closed and require recovery review.

## Dashboard workflow

Sign in with GitHub, generate controlled remediation, then explicitly confirm
branch delivery. Once PUSHED is recorded, explicitly confirm PR creation.
Delivery never automatically creates a PR. Status refresh is read-only and manual.
Prepared, committed, pushed, pending PR, verified PR, authorization failures,
conflicts, and uncertain outcomes are displayed separately.

OAuth navigation preserves only opaque artifact/delivery IDs in tab-local session
storage. Returning from sign-in performs no request or mutation automatically.
Restored IDs are untrusted references and every server action revalidates them.
No tokens, capabilities, artifact content, or authority fields are stored there.

Private-repository ingestion, automatic retries, rebasing, background workers,
and direct source/default-branch pushes are outside this workflow.

## Schema and tests

Migration: `20260929120000_artifact_ingestion_provenance` (additive nullable identity
fields and a false-by-default verification flag). Regenerate Prisma Client and
apply this migration before using the updated persistence code.

Focused tests:

```sh
npx tsx scripts/test-remediation-artifact-bridge.ts
npx tsx scripts/test-ingestion-provenance.ts
npx tsx scripts/test-public-remediation-boundary.ts
npx tsx scripts/test-verified-remediation-persistence.ts
npx tsx scripts/test-remediation-delivery-pipeline.ts
```

The first two use deterministic external-operation stubs. The persistence and
lifecycle tests exercise the configured database and isolated local Git repos.
None performs a real GitHub push.

Additional focused tests (no real GitHub mutations):

```sh
npx tsx scripts/test-developer-pull-request-api.ts
npx tsx scripts/test-remediation-delivery-workflow.ts
npx tsx scripts/test-remediation-delivery-ui.ts
npx tsx scripts/test-delivery-claims-database.ts
npx tsx scripts/test-developer-delivery-api.ts
npx tsx scripts/test-github-pull-request-delivery.ts
npx tsx scripts/test-github-pull-request-recovery.ts
```

The composed workflow stubs sandbox, Git, persistence, and GitHub operations while
running real remediation orchestration, API handlers, capability code, and the PR
engine. The database claim test uses an isolated local test database. UI interaction
tests use a deterministic hook harness; real browser/OAuth and GitHub end-to-end
validation remain separate integration checks.
