# GitHub App authenticated remediation push

`pushPersistedRemediationDelivery()` defaults to the GitHub App transport. It
requires COMMITTED evidence, matching delivery/artifact repository identity, and
the deterministic artifact branch before issuing a signed GitPushCapability.
`executeVerifiedGitPush()` verifies that capability and observes branch, HEAD,
remote, and clean workspace before opening the transport and acquiring a token.
It checks capability expiry again after authentication.

The transport accepts only exact GitHub HTTPS/SSH remote identities and pushes to
a canonical credential-free HTTPS URL. It does not edit the original Git config.
A temporary bare Git context reads the original object store, but has no source
repository hooks, URL rewrites, push options, or credential helpers. Shallow-clone
commit boundaries are copied as metadata. System/global
config and inherited Git tracing, askpass, proxies, and credential environment
variables are excluded. TLS verification is enabled and HTTP redirects disabled.
The Basic authorization header is supplied through command-local
`GIT_CONFIG_PARAMETERS`, using individually quoted key=value pairs compatible with
Git 2.25.1 and newer. It does not depend on `GIT_CONFIG_COUNT` or version branching.
Credentials never enter command arguments, URLs, files, or returned errors.
Disposal clears the credential environment, waits for active commands to finish,
and permanently rejects subsequent commands.
Temporary Git metadata contains no credentials and is removed after use.

The executor pushes `<commitSha>:refs/heads/<branch>` without force, then runs a
separate authenticated `git ls-remote --refs` against GitHub. Only an exact SHA and
ref match returns success to the pipeline, which can then persist PUSHED. PR
delivery remains downstream and is not invoked by these tests.

The generic executor still supports existing Git authentication. Trusted local
pipeline tests explicitly pass `null` as their transport for a local bare remote.
Transport factories are server-side dependencies, not request parameters.

## Tests

```sh
npx tsx scripts/test-github-app-git-push.ts
npx tsx scripts/test-github-app-token-scope.ts
npx tsx scripts/test-real-github-app-push-harness.ts
npx tsx scripts/test-remediation-delivery-pipeline.ts
npx tsc --noEmit
npm run lint
```

## Real repository test

The target requires `DEPLOYGUARD_PUSH_REPOSITORY_IDENTITY=owner/repository`.
Missing or malformed identities fail closed when opted in. URLs, whitespace,
credentials, and extra path components are rejected. The checkout origin,
persisted artifact/delivery, and App token identity must match exactly.
Default execution is a no-op:

```sh
npx tsx scripts/test-real-github-app-push.ts
```

Configure DATABASE_URL, GITHUB_APP_ID, and GITHUB_APP_PRIVATE_KEY_PATH as usual.
Use an isolated clean checkout with an origin for the exact target repository.
Use an isolated lint fixture such as `gevalinho/deployguard-lint-fixture` as the
integration-test target. The App must be installed on that fixture and you must
be authorized to push its deterministic remediation branch.
To use a COMMITTED delivery created through the existing lifecycle:

```sh
DEPLOYGUARD_REAL_GITHUB_PUSH_TEST=1 \
DEPLOYGUARD_PUSH_REPOSITORY_IDENTITY=gevalinho/deployguard-lint-fixture \
DEPLOYGUARD_PUSH_REPOSITORY_PATH=/absolute/path/to/isolated-lint-fixture-checkout \
DEPLOYGUARD_PUSH_DELIVERY_ID=existing-committed-delivery-id \
npx tsx scripts/test-real-github-app-push.ts
```

Alternatively, supply `DEPLOYGUARD_PUSH_ARTIFACT_ID` instead of the delivery ID.
The artifact must already have been verified and persisted by DeployGuard. The
checkout must be on its source branch, whose HEAD is checked against GitHub's
public branch API. The script calls the existing PREPARED and COMMITTED lifecycle
boundaries to construct the delivery. It does not fabricate PUSHED evidence.
Before preparation, the artifact's exact repository identity and verified
provenance must match the independently observed GitHub source branch and checkout
HEAD. Configure local commit author identity in that isolated checkout beforehand.
For artifact mode, use the same fixture command above, leave
DEPLOYGUARD_PUSH_DELIVERY_ID unset, and set
`DEPLOYGUARD_PUSH_ARTIFACT_ID=existing-verified-lint-artifact-id` instead.

These opt-in examples mutate the fixture's remediation branch. Do not run them
as part of non-mutating validation.

Before acquiring credentials or mutating the remote, the script prints
repositoryIdentity, sourceBranch, remediationBranch, and commitSha. It reports
installation resolution and scoped token issuance without printing credentials.
It then calls the persisted push boundary and independently reloads durable state.
It preserves audit records, does not change main, and creates no PR. If a push
succeeds but later verification/persistence fails, inspect the remote and durable
state before retrying. The script does not delete the remediation branch.

Git's process-local configuration mechanism is documented in
[git-config](https://git-scm.com/docs/git-config).
GitHub documents installation-token HTTP Git authentication in
[Authenticating as an installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).
