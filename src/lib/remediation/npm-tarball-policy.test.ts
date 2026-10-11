import { describe, expect, it } from "vitest";
import { isAuthorizedNpmTarball } from "./npm-tarball-policy";

describe("npm tarball authorization policy", () => {
  it("accepts a legitimate public npm tarball", () => {
    expect(
      isAuthorizedNpmTarball(
        "braces",
        "3.0.3",
        "https://registry.npmjs.org/braces/-/braces-3.0.3.tgz",
      ),
    ).toBe(true);
  });

  it("accepts a legitimate scoped npm package", () => {
    expect(
      isAuthorizedNpmTarball(
        "@babel/core",
        "7.26.0",
        "https://registry.npmjs.org/@babel/core/-/core-7.26.0.tgz",
      ),
    ).toBe(true);
  });

  it("rejects an unauthorized registry host", () => {
    expect(
      isAuthorizedNpmTarball(
        "braces",
        "3.0.3",
        "https://attacker.example/braces/-/braces-3.0.3.tgz",
      ),
    ).toBe(false);
  });

  it("rejects substitution with another package", () => {
    expect(
      isAuthorizedNpmTarball(
        "braces",
        "3.0.3",
        "https://registry.npmjs.org/lodash/-/lodash-3.0.3.tgz",
      ),
    ).toBe(false);
  });

  it("rejects a mismatched package version", () => {
    expect(
      isAuthorizedNpmTarball(
        "braces",
        "3.0.3",
        "https://registry.npmjs.org/braces/-/braces-3.0.2.tgz",
      ),
    ).toBe(false);
  });

  it("rejects URL query parameters", () => {
    expect(
      isAuthorizedNpmTarball(
        "braces",
        "3.0.3",
        "https://registry.npmjs.org/braces/-/braces-3.0.3.tgz?token=abc",
      ),
    ).toBe(false);
  });

  it("rejects malformed package versions", () => {
    expect(
      isAuthorizedNpmTarball(
        "braces",
        "../3.0.3",
        "https://registry.npmjs.org/braces/-/braces-3.0.3.tgz",
      ),
    ).toBe(false);
  });

  it.each([
    [
      "HTTP instead of HTTPS",
      "http://registry.npmjs.org/braces/-/braces-3.0.3.tgz",
    ],
    [
      "embedded URL credentials",
      "https://user:password@registry.npmjs.org/braces/-/braces-3.0.3.tgz",
    ],
    [
      "hostname spoofing",
      "https://registry.npmjs.org.attacker.example/braces/-/braces-3.0.3.tgz",
    ],
    [
      "unexpected port",
      "https://registry.npmjs.org:8443/braces/-/braces-3.0.3.tgz",
    ],
    [
      "URL fragment",
      "https://registry.npmjs.org/braces/-/braces-3.0.3.tgz#fragment",
    ],
    [
      "additional path segment",
      "https://registry.npmjs.org/braces/-/extra/braces-3.0.3.tgz",
    ],
  ])("rejects %s", (_scenario, resolved) => {
    expect(isAuthorizedNpmTarball("braces", "3.0.3", resolved)).toBe(false);
  });
});
