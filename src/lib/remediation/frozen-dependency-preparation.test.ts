import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync,
  symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFrozenSourceSnapshot, type FrozenSourceSnapshot } from "./frozen-source-snapshot";

const docker = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", async (original) => ({
  ...(await original()), runDockerSandboxCommand: docker,
}));
import { prepareFrozenNpmDependencies } from "./frozen-dependency-preparation";

const roots: string[] = [];
const snapshots: FrozenSourceSnapshot[] = [];
function directory(): string { const root = mkdtempSync(join(tmpdir(), "deployguard-prep-test-")); roots.push(root); return root; }
function fixture(): { root: string; snapshot: FrozenSourceSnapshot } {
  const root = directory();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "lodash-fixture", version: "1.0.0",
    private: true, scripts: { test: "node --test" }, dependencies: { lodash: "4.17.21" } }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "lodash-fixture", version: "1.0.0",
    lockfileVersion: 3, packages: { "": { name: "lodash-fixture", version: "1.0.0",
      dependencies: { lodash: "4.17.21" } }, "node_modules/lodash": { version: "4.17.21",
      resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
      integrity: "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==" } } }));
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "test", "lodash.test.js"), `const test = require('node:test');
    const _ = require('lodash');
    for (let index = 0; index < 4; index++) test('lodash case ' + index, () => {
      if (_.get({ value: index }, 'value') !== index) throw new Error('wrong value');
    });`);
  const snapshot = createFrozenSourceSnapshot(root); snapshots.push(snapshot);
  return { root, snapshot };
}
function install(workspace: string): void {
  const target = join(workspace, "node_modules", "lodash");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "package.json"), JSON.stringify({ name: "lodash", version: "4.17.21" }));
  writeFileSync(join(target, "index.js"), "module.exports = {get: (value, key) => value[key]};");
}
function installWithBin(workspace: string): void {
  install(workspace);
  const packageRoot = join(workspace, "node_modules", "lodash");
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "lodash", version: "4.17.21",
    bin: { "lodash-demo": "bin/cli.js" } }));
  mkdirSync(join(packageRoot, "bin"));
  writeFileSync(join(packageRoot, "bin", "cli.js"), "console.log('ok');\n");
  const bin = join(workspace, "node_modules", ".bin");
  mkdirSync(bin);
  symlinkSync("../lodash/bin/cli.js", join(bin, "lodash-demo"));
}
afterEach(() => {
  docker.mockReset();
  for (const snapshot of snapshots.splice(0)) snapshot.cleanup();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("frozen npm dependency preparation", () => {
  it("prepares the four-test lodash fixture in a separate Docker workspace", async () => {
    const { snapshot } = fixture();
    docker.mockImplementation(async (input: { repositoryPath: string; command: string[]; network: string }) => {
      expect(input.repositoryPath).not.toBe(snapshot.path);
      expect(input.command).toEqual(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
      expect(input.network).toBe("bridge");
      install(input.repositoryPath);
      return { status: "passed", exitCode: 0 };
    });
    const parent = directory();
    const prepared = await prepareFrozenNpmDependencies(snapshot, snapshot.identity, { temporaryParent: parent });
    expect(readFileSync(join(snapshot.path, "test", "lodash.test.js"), "utf8")).toContain("index < 4");
    expect(existsSync(join(snapshot.path, "node_modules"))).toBe(false);
    expect(prepared.sourceIdentity).toBe(snapshot.identity);
    expect(prepared.lockIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.dependencyIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(() => prepared.verify()).not.toThrow();
    prepared.cleanup(); prepared.cleanup();
    expect(readdirSync(parent)).toEqual([]);
  });
  it("rejects missing and inconsistent lockfiles before Docker", async () => {
    const root = directory();
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { lodash: "4.17.21" } }));
    let snapshot = createFrozenSourceSnapshot(root); snapshots.push(snapshot);
    await expect(prepareFrozenNpmDependencies(snapshot, snapshot.identity)).rejects.toThrow(/required/);
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3,
      packages: { "": { dependencies: { lodash: "4.17.20" } } } }));
    snapshot = createFrozenSourceSnapshot(root); snapshots.push(snapshot);
    await expect(prepareFrozenNpmDependencies(snapshot, snapshot.identity)).rejects.toThrow(/disagree/);
    expect(docker).not.toHaveBeenCalled();
  });
  it("rejects a changed frozen source identity", async () => {
    const { snapshot } = fixture();
    await expect(prepareFrozenNpmDependencies(snapshot, "0".repeat(64))).rejects.toThrow(/identity mismatch/);
    chmodSync(join(snapshot.path, "test", "lodash.test.js"), 0o600);
    writeFileSync(join(snapshot.path, "test", "lodash.test.js"), "tampered");
    await expect(prepareFrozenNpmDependencies(snapshot, snapshot.identity)).rejects.toThrow(/changed/);
    expect(docker).not.toHaveBeenCalled();
  });
  it("detects dependency tampering after preparation", async () => {
    const { snapshot } = fixture();
    docker.mockImplementation(async ({ repositoryPath }: { repositoryPath: string }) => {
      install(repositoryPath); return { status: "passed", exitCode: 0 };
    });
    const prepared = await prepareFrozenNpmDependencies(snapshot, snapshot.identity);
    try {
      writeFileSync(join(prepared.path, "lodash", "index.js"), "tampered");
      expect(() => prepared.verify()).toThrow(/changed/);
    } finally { prepared.cleanup(); }
  });
  it("detects a same-size dependency file change", async () => {
    const { snapshot } = fixture();
    docker.mockImplementation(async ({ repositoryPath }: { repositoryPath: string }) => {
      install(repositoryPath); return { status: "passed", exitCode: 0 };
    });
    const prepared = await prepareFrozenNpmDependencies(snapshot, snapshot.identity);
    try {
      const file = join(prepared.path, "lodash", "index.js");
      const content = readFileSync(file);
      content[0] ^= 1;
      writeFileSync(file, content);
      expect(() => prepared.verify()).toThrow(/changed/);
    } finally { prepared.cleanup(); }
  });
  it("accepts internal package and declared .bin links, then detects a replaced link", async () => {
    const { snapshot } = fixture();
    docker.mockImplementation(async ({ repositoryPath }: { repositoryPath: string }) => {
      installWithBin(repositoryPath);
      symlinkSync("index.js", join(repositoryPath, "node_modules", "lodash", "internal-link"));
      return { status: "passed", exitCode: 0 };
    });
    const prepared = await prepareFrozenNpmDependencies(snapshot, snapshot.identity);
    try {
      expect(() => prepared.verify()).not.toThrow();
      const executable = join(prepared.path, ".bin", "lodash-demo");
      unlinkSync(executable);
      symlinkSync("../lodash/index.js", executable);
      expect(() => prepared.verify()).toThrow(/Unsafe .bin link/);
      unlinkSync(executable);
      symlinkSync("../lodash/bin/cli.js", executable);
      expect(() => prepared.verify()).not.toThrow();
      const link = join(prepared.path, "lodash", "internal-link");
      unlinkSync(link);
      symlinkSync("package.json", link);
      expect(() => prepared.verify()).toThrow(/changed/);
    } finally { prepared.cleanup(); }
    expect(existsSync(prepared.path)).toBe(false);
  });
  it.each(["file", "escape", "undeclared"])("rejects unsafe .bin entries (%s) and cleans staging", async (kind) => {
    const { snapshot } = fixture();
    const parent = directory();
    docker.mockImplementation(async ({ repositoryPath }: { repositoryPath: string }) => {
      install(repositoryPath);
      const bin = join(repositoryPath, "node_modules", ".bin");
      mkdirSync(bin);
      if (kind === "file") writeFileSync(join(bin, "bad"), "not a link");
      else if (kind === "escape") symlinkSync("/etc/passwd", join(bin, "bad"));
      else symlinkSync("../lodash/index.js", join(bin, "bad"));
      return { status: "passed", exitCode: 0 };
    });
    await expect(prepareFrozenNpmDependencies(snapshot, snapshot.identity, { temporaryParent: parent }))
      .rejects.toThrow(/Unsafe .bin/);
    expect(readdirSync(parent)).toEqual([]);
  });
  it("detects an excluded-name file injected into the captured source", async () => {
    const { snapshot } = fixture();
    docker.mockImplementation(async ({ repositoryPath }: { repositoryPath: string }) => {
      install(repositoryPath); return { status: "passed", exitCode: 0 };
    });
    const prepared = await prepareFrozenNpmDependencies(snapshot, snapshot.identity);
    try {
      const mode = statSync(snapshot.path).mode & 0o777;
      chmodSync(snapshot.path, 0o700);
      writeFileSync(join(snapshot.path, ".eslintcache"), "injected");
      chmodSync(snapshot.path, mode);
      expect(() => prepared.verify()).toThrow(/changed/);
    } finally { prepared.cleanup(); }
  });
  it("rejects dependency links escaping the prepared tree and cleans partial output", async () => {
    const { snapshot } = fixture();
    const parent = directory();
    docker.mockImplementation(async ({ repositoryPath }: { repositoryPath: string }) => {
      install(repositoryPath);
      symlinkSync("/etc/passwd", join(repositoryPath, "node_modules", "lodash", "bad-link"));
      return { status: "passed", exitCode: 0 };
    });
    await expect(prepareFrozenNpmDependencies(snapshot, snapshot.identity, { temporaryParent: parent }))
      .rejects.toThrow(/Absolute dependency symlink/);
    expect(readdirSync(parent)).toEqual([]);
  });
  it("cleans a partial installation after npm ci fails", async () => {
    const { snapshot } = fixture();
    const parent = directory();
    docker.mockImplementation(async ({ repositoryPath }: { repositoryPath: string }) => {
      install(repositoryPath); return { status: "failed", exitCode: 1 };
    });
    await expect(prepareFrozenNpmDependencies(snapshot, snapshot.identity, { temporaryParent: parent }))
      .rejects.toThrow(/did not complete/);
    expect(readdirSync(parent)).toEqual([]);
  });
  it("rejects a successful exit without the locked dependency tree", async () => {
    const { snapshot } = fixture();
    const parent = directory();
    docker.mockResolvedValue({ status: "passed", exitCode: 0 });
    await expect(prepareFrozenNpmDependencies(snapshot, snapshot.identity, { temporaryParent: parent }))
      .rejects.toThrow(/incomplete/);
    expect(readdirSync(parent)).toEqual([]);
  });
  it("rejects source mutation during installation and cleans staging", async () => {
    const { snapshot } = fixture();
    const parent = directory();
    docker.mockImplementation(async ({ repositoryPath }: { repositoryPath: string }) => {
      install(repositoryPath);
      const source = join(snapshot.path, "test", "lodash.test.js");
      chmodSync(source, 0o600);
      writeFileSync(source, "tampered during install");
      return { status: "passed", exitCode: 0 };
    });
    await expect(prepareFrozenNpmDependencies(snapshot, snapshot.identity, { temporaryParent: parent }))
      .rejects.toThrow(/changed/);
    expect(readdirSync(parent)).toEqual([]);
  });
  it("rejects unsupported package-manager layouts", async () => {
    const root = directory();
    writeFileSync(join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@9.0.0" }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }));
    const snapshot = createFrozenSourceSnapshot(root); snapshots.push(snapshot);
    await expect(prepareFrozenNpmDependencies(snapshot, snapshot.identity)).rejects.toThrow(/Unsupported package-manager/);
  });
});
