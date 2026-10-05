import {
  describe,
  expect,
  it,
} from "vitest";

import {
  classifyPreparationFailureStatus,
} from "@/lib/orchestration/preparation-failure-policy";

describe(
  "classifyPreparationFailureStatus",
  () => {
    it(
      "blocks downstream checks when dependency preparation fails because of network infrastructure",
      () => {
        expect(
          classifyPreparationFailureStatus(
            "network"
          )
        ).toBe("blocked");
      }
    );

    it(
      "blocks downstream checks when sandbox preparation times out",
      () => {
        expect(
          classifyPreparationFailureStatus(
            "timeout"
          )
        ).toBe("blocked");
      }
    );

    it(
      "reports repository-caused preparation failures as errors",
      () => {
        expect(
          classifyPreparationFailureStatus(
            "repository"
          )
        ).toBe("error");
      }
    );

    it(
      "fails conservatively when no failure classification is available",
      () => {
        expect(
          classifyPreparationFailureStatus(
            undefined
          )
        ).toBe("error");
      }
    );
  }
);
