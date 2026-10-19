import { describe, expect, it } from "vitest";
import { trustedLodashFixture } from "./trusted-lodash-fixture";

const repository = "gevalinho/deployguard-vulnerable-fixture";
const commit = "37664ea49d1bfc714ef43c3d692571c59abf6414";

describe("trusted lodash fixture selection", () => {
  it("uses the server-pinned repository, commit, content hash, and four named tests", () => {
    expect(trustedLodashFixture(repository, commit, true)).toMatchObject({
      recognized: true,
      contract: {
        expectedTestFiles: [{ path: "test/lodash.test.js",
          sha256: "7a814fe171bc440e193138f4193439a6b1e4035917908a9a390781fe93df73dc" }],
        expectedExecutedTests: 4,
        expectedPassingTests: 4,
        expectedTestNames: [
          "get reads nested values and returns a default for missing paths",
          "set creates nested paths",
          "merge combines nested objects",
          "groupBy collects items under the selected property",
        ],
      },
    });
  });

  it("fails closed for the fixture repository without the pinned verified commit", () => {
    expect(trustedLodashFixture(repository, "a".repeat(40), true))
      .toEqual({ recognized: true, contract: null });
    expect(trustedLodashFixture(repository, commit, false))
      .toEqual({ recognized: true, contract: null });
    expect(trustedLodashFixture(repository, undefined, true))
      .toEqual({ recognized: true, contract: null });
  });

  it("does not select the fixture-specific path for another repository", () => {
    expect(trustedLodashFixture("attacker/deployguard-vulnerable-fixture", commit, true))
      .toEqual({ recognized: false, contract: null });
  });
});
