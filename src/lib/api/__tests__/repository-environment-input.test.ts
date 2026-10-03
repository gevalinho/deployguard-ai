import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseRepositoryEnvironment,
} from "../repository-environment-input";

describe(
  "parseRepositoryEnvironment",
  () => {
    it(
      "returns an empty environment when configuration is omitted",
      () => {
        expect(
          parseRepositoryEnvironment(
            undefined
          )
        ).toEqual({
          ok: true,
          environment: {},
        });
      }
    );

    it(
      "accepts valid repository-scoped environment values unchanged",
      () => {
        const result =
          parseRepositoryEnvironment({
            BUILD_SECRET:
              "repository-scoped-secret",
            NEXT_PUBLIC_API_URL:
              "https://example.test/api",
          });

        expect(result).toEqual({
          ok: true,
          environment: {
            BUILD_SECRET:
              "repository-scoped-secret",
            NEXT_PUBLIC_API_URL:
              "https://example.test/api",
          },
        });
      }
    );

    it.each([
      null,
      [],
      "BUILD_SECRET=value",
      42,
      true,
    ])(
      "rejects a non-object environment input",
      (value) => {
        const result =
          parseRepositoryEnvironment(
            value
          );

        expect(result).toEqual({
          ok: false,
          error:
            "Environment must be an object containing string values.",
        });
      }
    );

    it.each([
      123,
      true,
      null,
      {},
      [],
    ])(
      "rejects non-string environment values",
      (value) => {
        const result =
          parseRepositoryEnvironment({
            BUILD_SECRET: value,
          });

        expect(result).toEqual({
          ok: false,
          error:
            "Environment variable BUILD_SECRET must contain a string value.",
        });
      }
    );

    it.each([
      "INVALID-NAME",
      "INVALID.NAME",
      "1INVALID",
      "INVALID NAME",
      "",
    ])(
      "rejects invalid environment variable name %s",
      (name) => {
        const result =
          parseRepositoryEnvironment({
            [name]: "value",
          });

        expect(result).toEqual({
          ok: false,
          error:
            `Invalid environment variable name: ${name}.`,
        });
      }
    );

    it(
      "accepts conventional environment variable names",
      () => {
        const result =
          parseRepositoryEnvironment({
            BUILD_SECRET: "one",
            _INTERNAL_VALUE: "two",
            VALUE_123: "three",
          });

        expect(result.ok).toBe(true);
      }
    );

    it(
      "rejects more than fifty environment variables",
      () => {
        const environment =
          Object.fromEntries(
            Array.from(
              {
                length: 51,
              },
              (_, index) => [
                `VARIABLE_${index}`,
                "value",
              ]
            )
          );

        expect(
          parseRepositoryEnvironment(
            environment
          )
        ).toEqual({
          ok: false,
          error:
            "Environment may contain at most 50 variables.",
        });
      }
    );

    it(
      "accepts a value at the maximum length",
      () => {
        const value =
          "x".repeat(
            16 * 1024
          );

        const result =
          parseRepositoryEnvironment({
            BUILD_SECRET: value,
          });

        expect(result).toEqual({
          ok: true,
          environment: {
            BUILD_SECRET: value,
          },
        });
      }
    );

    it(
      "rejects a value exceeding the maximum length",
      () => {
        const result =
          parseRepositoryEnvironment({
            BUILD_SECRET:
              "x".repeat(
                16 * 1024 + 1
              ),
          });

        expect(result).toEqual({
          ok: false,
          error:
            "Environment variable BUILD_SECRET exceeds the maximum allowed value length.",
        });
      }
    );

    it(
      "never includes a secret value in validation errors",
      () => {
        const secret =
          "SUPER-SENSITIVE-SECRET-MUST-NOT-LEAK";

        const result =
          parseRepositoryEnvironment({
            BUILD_SECRET: {
              secret,
            },
          });

        expect(result.ok).toBe(false);

        if (!result.ok) {
          expect(
            result.error
          ).not.toContain(
            secret
          );
        }
      }
    );
  }
);
