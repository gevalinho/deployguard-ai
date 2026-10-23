import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPackageManager } from "./package-manager";
import { createRunScriptCommand } from "./package-manager-command";

function fixture(lockfileVersion: string, packageManager?: string) {
  const root = mkdtempSync(join(tmpdir(), "deployguard-pnpm-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", ...(packageManager === undefined ? {} : { packageManager }) }));
  writeFileSync(join(root, "pnpm-lock.yaml"), `lockfileVersion: '${lockfileVersion}'\n`);
  return root;
}

describe("pnpm compatibility", () => {
  it.each([["6.0", "8.15.9"], ["9.0", "9.15.9"], ["9.1", "9.15.9"]])("pins unpinned lockfile %s to pnpm %s", (format, version) => {
    const root = fixture(format);
    try {
      const manager = detectPackageManager(root)!;
      expect(manager.version).toBe(version);
      expect(manager.compatibilityError).toBeUndefined();
      expect(createRunScriptCommand(manager, "build").command[1]).toBe(`pnpm@${version}`);
      expect(readFileSync(join(root, "pnpm-lock.yaml"), "utf8")).toBe(`lockfileVersion: '${format}'\n`);
      expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))).not.toHaveProperty("packageManager");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([
    ["6.0", "pnpm@8.15.9", undefined],
    ["9.0", "pnpm@10.19.0", undefined],
    ["6.0", "pnpm@12.15.0", "repository"],
    ["9.0", "pnpm@8.15.9", "repository"],
    ["6.0", "pnpm@latest", "repository"],
    ["9.0", "yarn@4.9.2", "repository"],
    ["10.0", "pnpm@10.19.0", "capability"],
  ] as const)("checks %s and %s", (format, pin, kind) => {
    const root = fixture(format, pin);
    try {
      const manager = detectPackageManager(root)!;
      expect(manager.compatibilityKind).toBe(kind);
      if (!kind) expect(manager.version).toBe(pin.split("@")[1]);
      else expect(manager.compatibilityError).toContain("lockfileVersion");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("unchanged npm and Yarn detection", () => {
  it.each([1, 2, 3])("detects npm lockfile version %i", (version) => {
    const root = mkdtempSync(join(tmpdir(), "deployguard-npm-"));
    try {
      writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"1.0.0"}');
      writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: version }));
      expect(detectPackageManager(root)?.name).toBe("npm");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([1, 2, 3, 4])("detects Yarn major %i", (major) => {
    const root = mkdtempSync(join(tmpdir(), "deployguard-yarn-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ packageManager: `yarn@${major}.0.0` }));
      writeFileSync(join(root, "yarn.lock"), "");
      if (major > 1) writeFileSync(join(root, ".yarnrc.yml"), "nodeLinker: node-modules\n");
      const manager = detectPackageManager(root)!;
      expect(manager.majorVersion).toBe(major);
      expect(manager.yarnMode).toBe(major === 1 ? "classic" : "modern");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
