import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyNpmRegistryMetadata } from "./npm-registry-verifier";

const packageName = "braces";
const version = "3.0.3";
const resolved = "https://registry.npmjs.org/braces/-/braces-3.0.3.tgz";
const integrity =
  "sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==";

function mockRegistry(overrides: Record<string, unknown> = {}) {
  const metadata = {
    name: packageName,
    version,
    dist: { tarball: resolved, integrity },
    ...overrides,
  };

  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => metadata,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("npm registry metadata verification", () => {
  it("accepts matching official registry metadata", async () => {
    const fetchMock = mockRegistry();

    const result = await verifyNpmRegistryMetadata(
      packageName,
      version,
      resolved,
      integrity,
    );

    expect(result.valid, result.reason).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://registry.npmjs.org/braces/3.0.3",
      expect.objectContaining({
        redirect: "error",
        cache: "no-store",
      }),
    );
  });

  it("rejects a mismatched integrity hash", async () => {
    mockRegistry({
      dist: {
        tarball: resolved,
        integrity: `sha512-${"A".repeat(86)}==`,
      },
    });

    const result = await verifyNpmRegistryMetadata(
      packageName,
      version,
      resolved,
      integrity,
    );

    expect(result.valid).toBe(false);
  });

  it("rejects a mismatched package identity", async () => {
    mockRegistry({ name: "another-package" });

    const result = await verifyNpmRegistryMetadata(
      packageName,
      version,
      resolved,
      integrity,
    );

    expect(result.valid).toBe(false);
  });

  it("rejects malformed integrity before contacting npm", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await verifyNpmRegistryMetadata(
      packageName,
      version,
      resolved,
      "sha512-invalid",
    );

    expect(result.valid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects registry HTTP errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    const result = await verifyNpmRegistryMetadata(
      packageName,
      version,
      resolved,
      integrity,
    );

    expect(result.valid).toBe(false);
  });

  it("fails closed when the registry is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network unavailable"),
    );

    const result = await verifyNpmRegistryMetadata(
      packageName,
      version,
      resolved,
      integrity,
    );

    expect(result.valid).toBe(false);
  });
  it("rejects registry metadata with a mismatched version", async () => {
    mockRegistry({ version: "3.0.2" });

    const result = await verifyNpmRegistryMetadata(
      packageName,
      version,
      resolved,
      integrity,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("does not match the npm registry");
  });

  it("rejects a mismatched tarball path on the authorized registry", async () => {
    mockRegistry({
      dist: {
        tarball: "https://registry.npmjs.org/braces/-/braces-3.0.2.tgz",
        integrity,
      },
    });

    const result = await verifyNpmRegistryMetadata(
      packageName,
      version,
      resolved,
      integrity,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("does not match the npm registry");
  });
});

describe("scoped npm package verification", () => {
  it("accepts valid scoped package metadata", async () => {
    const scopedName = "@babel/core";
    const scopedVersion = "7.26.0";
    const scopedResolved =
      "https://registry.npmjs.org/@babel/core/-/core-7.26.0.tgz";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: scopedName,
        version: scopedVersion,
        dist: {
          tarball: scopedResolved,
          integrity,
        },
      }),
    } as Response);

    const result = await verifyNpmRegistryMetadata(
      scopedName,
      scopedVersion,
      scopedResolved,
      integrity,
    );

    expect(result.valid, result.reason).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://registry.npmjs.org/%40babel%2Fcore/7.26.0",
      expect.objectContaining({
        redirect: "error",
      }),
    );
  });

  it("rejects malformed scoped package names", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await verifyNpmRegistryMetadata(
      "@babel/",
      "7.26.0",
      resolved,
      integrity,
    );

    expect(result.valid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("npm registry response integrity", () => {
  it("rejects registry metadata with no integrity hash", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: packageName,
        version,
        dist: {
          tarball: resolved,
        },
      }),
    } as Response);

    const result = await verifyNpmRegistryMetadata(
      packageName,
      version,
      resolved,
      integrity,
    );

    expect(result.valid).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("npm registry tarball trust policy", () => {
  it("rejects an unauthorized tarball host even when registry metadata matches", async () => {
    const maliciousResolved =
      "https://attacker.example/braces/-/braces-3.0.3.tgz";

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: packageName,
        version,
        dist: {
          tarball: maliciousResolved,
          integrity,
        },
      }),
    } as Response);

    const result = await verifyNpmRegistryMetadata(
      packageName,
      version,
      maliciousResolved,
      integrity,
    );

    expect(result.valid).toBe(false);
  });
});
