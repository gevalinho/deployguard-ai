import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerifiedPatch } from "./verified-patch";
import { verifyDependencyApproval } from "./dependency-approval-verifier";

const fixture = join(
  process.cwd(),
  "src/lib/remediation/__fixtures__/npm-braces-upgrade",
);

function loadFixture(): VerifiedPatch {
  const read = (name: string) => readFileSync(join(fixture, name), "utf8");

  return {
    fileCount: 2,
    files: [
      {
        path: "package.json",
        changeType: "modified",
        before: read("package-before.json"),
        after: read("package-after.json"),
      },
      {
        path: "package-lock.json",
        changeType: "modified",
        before: read("package-lock-before.json"),
        after: read("package-lock-after.json"),
      },
    ],
  };
}

function registryMetadata(patch: VerifiedPatch) {
  const lock = JSON.parse(
    patch.files.find((file) => file.path === "package-lock.json")!.after!,
  );

  const target = lock.packages["node_modules/braces"];

  return {
    name: "braces",
    version: "3.0.3",
    dist: {
      tarball: target.resolved,
      integrity: target.integrity,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dependency approval verifier", () => {
  it("accepts a valid mutation with matching registry metadata", async () => {
    const patch = loadFixture();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => registryMetadata(patch),
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyDependencyApproval(patch, "braces", "3.0.3");

    expect(result.valid).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an unauthorized dependency version before registry access", async () => {
    const patch = loadFixture();
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyDependencyApproval(patch, "braces", "3.0.4");

    expect(result.valid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects tampered integrity metadata", async () => {
    const patch = loadFixture();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...registryMetadata(patch),
        dist: {
          ...registryMetadata(patch).dist,
          integrity: "sha512-" + "A".repeat(86) + "==",
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyDependencyApproval(patch, "braces", "3.0.3");

    expect(result.valid).toBe(false);
  });

  it("fails closed when the npm registry is unavailable", async () => {
    const patch = loadFixture();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network unavailable")),
    );

    const result = await verifyDependencyApproval(patch, "braces", "3.0.3");

    expect(result.valid).toBe(false);
  });

  it("rejects missing integrity metadata before registry access", async () => {
    const patch = loadFixture();
    const lockChange = patch.files.find(
      (file) => file.path === "package-lock.json",
    )!;

    const lock = JSON.parse(lockChange.after!);
    delete lock.packages["node_modules/braces"].integrity;
    lockChange.after = JSON.stringify(lock);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyDependencyApproval(patch, "braces", "3.0.3");

    expect(result.valid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unrelated file changes before registry access", async () => {
    const patch = loadFixture();

    patch.files.push({
      path: "src/app/page.tsx",
      changeType: "modified",
      before: "export default function Page() { return null; }",
      after: "export default function Page() { return <div>Changed</div>; }",
    });

    patch.fileCount = patch.files.length;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyDependencyApproval(patch, "braces", "3.0.3");

    expect(result.valid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
