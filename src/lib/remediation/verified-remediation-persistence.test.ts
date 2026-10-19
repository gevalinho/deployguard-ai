import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { VerifiedPatch } from "./verified-patch";
import { createVerifiedPatchArtifact } from "./verified-patch-artifact";

const create = vi.hoisted(() => vi.fn(async (...args: unknown[]) => {
  if (args.length !== 3) throw new Error("Unexpected persistence call.");
  return { id: "artifact123" };
}));
vi.mock("./trusted-artifact-repository", () => ({ persistVerifiedArtifact: create }));

import { persistProvenRemediationArtifact } from "./verified-remediation-persistence";

const fixture = join(process.cwd(), "src/lib/remediation/__fixtures__/npm-braces-upgrade");
const contents = (name: string) => readFileSync(join(fixture, name), "utf8");
const patch: VerifiedPatch = { fileCount: 2, files: [
  { path: "package.json", changeType: "modified", before: contents("package-before.json"),
    after: contents("package-after.json") },
  { path: "package-lock.json", changeType: "modified", before: contents("package-lock-before.json"),
    after: contents("package-lock-after.json") },
] };
const dependency = { strategy: "dependency_security" as const, patch, packageName: "braces", version: "3.0.3" };
const artifact = createVerifiedPatchArtifact(patch);

describe("proven dependency artifact persistence boundary", () => {
  it("stores the exact approved npm patch only when proof is proven", async () => {
    create.mockClear();
    expect(await persistProvenRemediationArtifact("owner/repo", "proven", artifact, undefined, dependency))
      .toEqual({ id: "artifact123" });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toBe("owner/repo");
    expect(create.mock.calls[0]?.[1]).toEqual(artifact);
  });

  it("rejects unproven proof, changed bytes, and unsupported dependency paths", async () => {
    create.mockClear();
    expect(await persistProvenRemediationArtifact("owner/repo", "inconclusive", artifact, undefined, dependency)).toBeNull();
    expect(await persistProvenRemediationArtifact("owner/repo", "proven",
      { ...artifact, content: `${artifact.content}\n` }, undefined, dependency)).toBeNull();
    expect(await persistProvenRemediationArtifact("owner/repo", "proven", artifact, undefined,
      { ...dependency, patch: { ...patch, files: [{ ...patch.files[0], path: "src/index.js" }, patch.files[1]] } }))
      .toBeNull();
    expect(await persistProvenRemediationArtifact("owner/repo", "proven", artifact, undefined,
      undefined as unknown as typeof dependency)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
