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

## Future explicit delivery API

That endpoint is intentionally not implemented here. Its request should contain
only the opaque artifact ID (and any separately designed explicit user intent).
The server must authenticate the requester and authorize access and delivery to
the artifact's stored repository; possession of an ID is insufficient.

After authorization, load trusted artifact metadata and independently re-ingest a
clean disposable Git checkout for the stored repository. The assessment archive
path alone is insufficient: delivery needs real Git objects and a verified base
commit. Obtain fresh remote commit/branch evidence server-side, reject fallback
provenance, and require agreement with the artifact's recorded base. If the branch
has advanced, require a new verified remediation; do not silently rebase a patch.
Never accept a repository path, commit, source branch, target branch, or provenance
flag from client JSON, and never reuse old assessment provenance as the new
remote observation.

Only then invoke the existing prepare → commit → App-authenticated push pipeline
with server-owned signing material. Keep its signed capability checks, exact
commit/branch push, independent remote verification, and durable transition
ordering. The endpoint still needs request authentication/authorization,
concurrent-request and retry handling, workspace cleanup, and endpoint-level
adversarial tests before release. PR creation remains a separate downstream step.

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
