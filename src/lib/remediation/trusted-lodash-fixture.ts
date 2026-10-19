/** Server-controlled allowlist for the single supported lodash regression fixture.
 * Values must be provisioned independently of the assessed repository. In
 * particular, never calculate the trusted test hash from an ingested workspace.
 */
import type { TrustedLodashProofContract } from "./frozen-regression-runner";

// This registry is part of the DeployGuard server release, never the ingested
// repository. The commit authorizes the original source; the test hash is
// checked separately against the post-remediation frozen source.
const TRUSTED_REPOSITORY = "gevalinho/deployguard-vulnerable-fixture";
const TRUSTED_COMMIT = "37664ea49d1bfc714ef43c3d692571c59abf6414";
const TRUSTED_TEST_HASH = "7a814fe171bc440e193138f4193439a6b1e4035917908a9a390781fe93df73dc";
const TRUSTED_TEST_NAMES = [
  "get reads nested values and returns a default for missing paths",
  "set creates nested paths",
  "merge combines nested objects",
  "groupBy collects items under the selected property",
] as const;

export interface TrustedLodashFixtureSelection {
  readonly recognized: boolean;
  readonly contract: TrustedLodashProofContract | null;
}

export function trustedLodashFixture(repositoryFullName: string,
  sourceCommitSha: string | undefined, remoteVerified: boolean): TrustedLodashFixtureSelection {
  if (repositoryFullName.toLowerCase() !== TRUSTED_REPOSITORY)
    return { recognized: false, contract: null };

  if (!remoteVerified || sourceCommitSha?.toLowerCase() !== TRUSTED_COMMIT)
    return { recognized: true, contract: null };
  return { recognized: true, contract: {
    fixture: "lodash-node22",
    expectedTestFiles: [{ path: "test/lodash.test.js", sha256: TRUSTED_TEST_HASH }],
    expectedExecutedTests: 4,
    expectedPassingTests: 4,
    expectedTestNames: [...TRUSTED_TEST_NAMES],
  } };
}
