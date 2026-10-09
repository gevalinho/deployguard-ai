import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureWorkspaceSnapshot, createVerifiedPatch, IncompleteDependencyArtifactError } from "./verified-patch";

const roots: string[] = [];
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });
function repository() {
  const root = mkdtempSync(join(tmpdir(), "dg-patch-completeness-"));
  roots.push(root);
  return root;
}

describe("dependency artifact completeness", () => {
  it("captures manifest and lockfile changes together", () => {
    const root = repository();
    writeFileSync(join(root, "package.json"), '{"version":"1"}');
    writeFileSync(join(root, "package-lock.json"), '{"version":"1"}');
    const before = captureWorkspaceSnapshot(root);
    writeFileSync(join(root, "package.json"), '{"version":"2"}');
    writeFileSync(join(root, "package-lock.json"), '{"version":"2"}');
    expect(createVerifiedPatch(before, captureWorkspaceSnapshot(root)).files.map((file) => file.path))
      .toEqual(["package-lock.json", "package.json"]);
  });

  it("rejects a changed lockfile above the bounded artifact size", () => {
    const root = repository();
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "package-lock.json"), "a".repeat(512 * 1024 + 1));
    const before = captureWorkspaceSnapshot(root);
    writeFileSync(join(root, "package.json"), '{"changed":true}');
    writeFileSync(join(root, "package-lock.json"), "b".repeat(512 * 1024 + 1));
    expect(() => createVerifiedPatch(before, captureWorkspaceSnapshot(root)))
      .toThrow(IncompleteDependencyArtifactError);
  });

  it("rejects a lockfile that grows beyond the snapshot limit", () => {
    const root = repository();
    writeFileSync(join(root, "package-lock.json"), "{}");
    const before = captureWorkspaceSnapshot(root);
    writeFileSync(join(root, "package-lock.json"), "a".repeat(512 * 1024 + 1));
    expect(() => createVerifiedPatch(before, captureWorkspaceSnapshot(root)))
      .toThrow(IncompleteDependencyArtifactError);
  });

  it("detects changed nested workspace manifests", () => {
    const root = repository();
    mkdirSync(join(root, "packages", "app"), { recursive: true });
    writeFileSync(join(root, "packages", "app", "package.json"), "{}");
    const before = captureWorkspaceSnapshot(root);
    writeFileSync(join(root, "packages", "app", "package.json"), '{"changed":true}');
    expect(createVerifiedPatch(before, captureWorkspaceSnapshot(root)).files[0].path)
      .toBe("packages/app/package.json");
  });
});
