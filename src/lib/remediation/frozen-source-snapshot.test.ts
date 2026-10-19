import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFrozenSourceSnapshot, type FrozenSourceSnapshot } from "./frozen-source-snapshot";

const roots: string[] = [];
const snapshots: FrozenSourceSnapshot[] = [];
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "deployguard-frozen-test-"));
  roots.push(path);
  return path;
}
function fixture(): string {
  const root = directory();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "lodash-fixture", private: true,
    scripts: { test: "node --test" }, dependencies: { lodash: "4.17.20" } }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3,
    packages: { "": { dependencies: { lodash: "4.17.20" } } } }));
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "test", "lodash.test.js"), `const test = require('node:test');
    for (let index = 0; index < 4; index++) test('case ' + index, () => {});`);
  return root;
}
function capture(root: string, options?: Parameters<typeof createFrozenSourceSnapshot>[1]) {
  const result = createFrozenSourceSnapshot(root, options);
  snapshots.push(result);
  return result;
}
afterEach(() => {
  for (const snapshot of snapshots.splice(0)) snapshot.cleanup();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("frozen post-remediation source snapshot", () => {
  it("copies the four-test dependency fixture and gives identical trees one identity", () => {
    const root = fixture();
    const first = capture(root);
    const second = capture(root);
    expect(first.identity).toMatch(/^[0-9a-f]{64}$/);
    expect(first.identity).toBe(second.identity);
    expect(first.fileCount).toBe(3);
    expect(readFileSync(join(first.path, "test", "lodash.test.js"), "utf8"))
      .toContain("index < 4");
    expect(lstatSync(first.path).isDirectory()).toBe(true);
    expect(lstatSync(dirname(first.path)).mode & 0o777).toBe(0o700);
    first.cleanup();
    first.cleanup();
    expect(existsSync(first.path)).toBe(false);
  });

  it("includes binary and files larger than the patch snapshot's 512 KiB limit", () => {
    const root = fixture();
    const binary = Buffer.alloc(600 * 1024, 0xff);
    binary[0] = 0;
    writeFileSync(join(root, "asset.bin"), binary);
    const first = capture(root);
    expect(readFileSync(join(first.path, "asset.bin"))).toEqual(binary);
    binary[binary.length - 1] = 1;
    writeFileSync(join(root, "asset.bin"), binary);
    expect(capture(root).identity).not.toBe(first.identity);
  });

  it("rejects an oversized binary file instead of silently omitting it", () => {
    const root = fixture();
    writeFileSync(join(root, "oversized.bin"), Buffer.alloc(2_048, 0));
    expect(() => capture(root, { limits: { maxFileBytes: 1_024 } })).toThrow(/byte limit/);
  });

  it("enforces total-byte and traversal limits", () => {
    const root = fixture();
    expect(() => capture(root, { limits: { maxTotalBytes: 16 } })).toThrow(/byte limit/);
    expect(() => capture(root, { limits: { maxDepth: 1 } })).not.toThrow();
    mkdirSync(join(root, "test", "nested"));
    expect(() => capture(root, { limits: { maxDepth: 1 } })).toThrow(/depth exceeded/);
  });

  it("rejects escaping and internal symlinks without copying their targets", () => {
    const root = fixture();
    const outside = directory();
    writeFileSync(join(outside, "secret"), "outside");
    symlinkSync(join(outside, "secret"), join(root, "outside-link"));
    expect(() => capture(root)).toThrow(/symlinks/);
    rmSync(join(root, "outside-link"));
    symlinkSync("package.json", join(root, "inside-link"));
    expect(() => capture(root)).toThrow(/symlinks/);
  });

  it.each(["node_modules", ".next", ".git", ".eslintcache"])(
    "rejects a symlink named like an excluded path: %s", (name) => {
      const root = fixture();
      const outside = directory();
      symlinkSync(outside, join(root, name));
      expect(() => capture(root)).toThrow(/symlinks/);
    });

  it("rejects a Unix socket as an unsupported special file", async () => {
    const root = fixture();
    const socket = join(root, "socket");
    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socket, resolve);
      });
      expect(() => capture(root)).toThrow(/Special source files/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each(["node_modules", ".eslintcache"])(
    "rejects a special file named like an excluded path: %s", async (name) => {
      const root = fixture();
      const server = createServer();
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(join(root, name), resolve);
        });
        expect(() => capture(root)).toThrow(/Special source files/);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

  it("changes identity for executable mode and path changes", () => {
    const root = fixture();
    const file = join(root, "run.sh");
    writeFileSync(file, "exit 0\n");
    chmodSync(file, 0o644);
    const first = capture(root);
    chmodSync(file, 0o755);
    const second = capture(root);
    expect(second.identity).not.toBe(first.identity);
    rmSync(file);
    writeFileSync(join(root, "other.sh"), "exit 0\n", { mode: 0o755 });
    expect(capture(root).identity).not.toBe(second.identity);
  });

  it("rejects case-folded path collisions", () => {
    const root = fixture();
    writeFileSync(join(root, "A.txt"), "one");
    writeFileSync(join(root, "a.txt"), "two");
    expect(() => capture(root)).toThrow(/collision/);
  });

  it("removes the private partial tree after a late capture failure", () => {
    const root = fixture();
    const parent = directory();
    writeFileSync(join(root, "a.txt"), "copied first");
    symlinkSync("package.json", join(root, "z-link"));
    expect(() => capture(root, { temporaryParent: parent })).toThrow(/symlinks/);
    expect(readdirSync(parent)).toEqual([]);
  });

  it("omits only declared caches while retaining generated build files", () => {
    const root = fixture();
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "dependency.js"), "cached");
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist", "index.js"), "generated source");
    const snapshot = capture(root);
    expect(existsSync(join(snapshot.path, "node_modules"))).toBe(false);
    expect(readFileSync(join(snapshot.path, "dist", "index.js"), "utf8"))
      .toBe("generated source");
  });
});
