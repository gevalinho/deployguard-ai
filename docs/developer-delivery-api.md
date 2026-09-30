# Developer delivery API foundation

This opt-in API does not run during remediation. The remediation response's `verifiedArtifactReference.artifactId` is the only client-supplied delivery identity.

Configure the GitHub App user authorization callback at `/api/auth/github/callback` and set `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_OAUTH_REDIRECT_URI` (an HTTPS URL), and `DEPLOYGUARD_SESSION_SECRET` (at least 32 bytes). The existing GitHub App ID and private-key configuration remain required for installation tokens. Apply the additive `20260930190000_remediation_delivery_request` migration separately after review; code must not serve delivery requests until it is applied.

A developer visits `GET /api/auth/github/start`. The OAuth callback exchanges the code, reads the immutable GitHub user ID, and sets an eight-hour signed, HttpOnly, Secure, SameSite=Lax session cookie. The user access token is not persisted. Each delivery request uses a repository-scoped installation token and GitHub's collaborator-permission endpoint to require the signed-in user to have write, maintain, or admin permission. GitHub App installation access alone is insufficient.

`POST /api/remediation/delivery` requires same-origin credentials and exactly:

```json
{"artifactId":"opaque-persisted-id","confirmDelivery":true}
```

The server loads the artifact, checks remotely verified provenance, atomically claims its artifact ID, reconstructs a disposable Git checkout from the persisted repository identity, verifies the checkout against the remote provenance, and calls the existing signed prepare, commit, and push pipeline. It never creates a PR. A duplicate returns the current compatible durable delivery, or HTTP 409 if an operation is in progress or needs explicit recovery. A claim with no linked delivery ID can indicate a crash or uncertain preparation and is not retried automatically.

A successful response has `{ "ok": true, "delivery": { "artifactId", "deliveryId", "repositoryIdentity", "status", "branchName", "commitSha", "pushedAt" } }`. `GET /api/remediation/delivery/{deliveryId}` requires the same developer session and current repository permission and returns this durable state. It includes `pullRequest: { number, url, state }` only for a VERIFIED durable PR row. Errors contain fixed, credential-safe messages.

This first slice supports repositories available to the existing public-repository ingestion and HTTPS clone path. Private repository ingestion, a browser delivery consent UI, explicit PR API, claim recovery tooling, session revocation, and request rate limits remain follow-up work. Do not use the real push or PR harness as an API test.
