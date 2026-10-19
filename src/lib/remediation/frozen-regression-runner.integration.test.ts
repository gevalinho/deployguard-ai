import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDockerSandboxCommand } from "@/lib/sandbox/docker-sandbox";
import { createFrozenSourceSnapshot } from "./frozen-source-snapshot";
import { prepareFrozenNpmDependencies } from "./frozen-dependency-preparation";
import { runFrozenNodeRegression } from "./frozen-regression-runner";
import { trustedLodashFixture } from "./trusted-lodash-fixture";
import { FrozenArtifactContainerStateError, runWithArtifactOwnership } from "./frozen-artifact-ownership";

const run = process.env.DEPLOYGUARD_DOCKER_INTEGRATION === "1" ? it : it.skip;
const trustedLodashTest = `const test = require('node:test');
const assert = require('node:assert/strict');
const { get, set, merge, groupBy } = require('lodash');

test('get reads nested values and returns a default for missing paths', () => {
  const user = { profile: { name: 'Ada' } };

  assert.equal(get(user, 'profile.name'), 'Ada');
  assert.equal(get(user, 'profile.role', 'viewer'), 'viewer');
});

test('set creates nested paths', () => {
  const user = {};

  assert.equal(set(user, 'profile.name', 'Ada'), user);
  assert.deepEqual(user, { profile: { name: 'Ada' } });
});

test('merge combines nested objects', () => {
  const target = { profile: { name: 'Ada', role: 'viewer' } };

  assert.equal(merge(target, { profile: { role: 'editor', active: true } }), target);
  assert.deepEqual(target, {
    profile: { name: 'Ada', role: 'editor', active: true },
  });
});

test('groupBy collects items under the selected property', () => {
  const items = [
    { name: 'Ada', team: 'engineering' },
    { name: 'Lin', team: 'design' },
    { name: 'Sam', team: 'engineering' },
  ];

  assert.deepEqual(groupBy(items, 'team'), {
    engineering: [items[0], items[2]],
    design: [items[1]],
  });
});
`;
const trustedContract = trustedLodashFixture("gevalinho/deployguard-vulnerable-fixture",
  "37664ea49d1bfc714ef43c3d692571c59abf6414", true).contract;
describe("real isolated frozen Node regression", () => {
  run("runs all four lodash tests and rejects writes to both read-only mounts", async () => {
    const root = mkdtempSync(join(tmpdir(), "deployguard-regression-real-"));
    const scratch = mkdtempSync(join(tmpdir(), "deployguard-regression-probe-"));
    let snapshot: ReturnType<typeof createFrozenSourceSnapshot> | undefined;
    let prepared: Awaited<ReturnType<typeof prepareFrozenNpmDependencies>> | undefined;
    let unresolved: FrozenArtifactContainerStateError | undefined;
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "lodash-fixture", version: "1.0.0",
        private: true, scripts: { test: "node --test", postinstall: "touch SHOULD_NOT_RUN" },
        dependencies: { lodash: "4.17.21" } }));
      writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "lodash-fixture", version: "1.0.0",
        lockfileVersion: 3, packages: { "": { name: "lodash-fixture", version: "1.0.0",
          dependencies: { lodash: "4.17.21" } }, "node_modules/lodash": { version: "4.17.21",
          resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
          integrity: "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==" } } }));
      mkdirSync(join(root, "test"));
      writeFileSync(join(root, "test", "lodash.test.js"), trustedLodashTest);
      expect(trustedContract).not.toBeNull();
      expect(createHash("sha256").update(trustedLodashTest).digest("hex"))
        .toBe(trustedContract!.expectedTestFiles[0].sha256);
      snapshot = createFrozenSourceSnapshot(root);
      prepared = await prepareFrozenNpmDependencies(snapshot, snapshot.identity);
      const result = await runFrozenNodeRegression(snapshot, prepared, trustedContract!);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe("passed");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("# tests 4");
      expect(result.testFiles).toEqual(["test/lodash.test.js"]);

      // The shared runner's /workspace bind remains writable scratch. These two
      // explicit mounts are read-only and are checked in container mountinfo.
      const sourcePath = snapshot.path;
      const dependencyPath = prepared.path;
      const probe = await runWithArtifactOwnership([sourcePath, dependencyPath, scratch], scratch,
        () => runDockerSandboxCommand({ repositoryPath: scratch,
        command: ["node", "-e", `const fs=require('node:fs');
          const mounts=fs.readFileSync('/proc/self/mountinfo','utf8').split('\\n');
          for (const path of ['/source','/deps']) {
            const row=mounts.find(line=>line.split(' ')[4]===path);
            if (!row || !row.split(' ')[5].split(',').includes('ro')) process.exit(2);
            try { fs.writeFileSync(path+'/_write_probe','x'); process.exit(3); }
            catch (error) { if (!['EROFS','EACCES','EPERM'].includes(error.code)) process.exit(4); }
          }`],
        network: "none", user: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        mounts: [
          { source: sourcePath, target: "/source", readOnly: true },
          { source: dependencyPath, target: "/deps", readOnly: true },
        ],
        limits: { memoryMb: 2048, cpus: 1, timeoutMs: 5 * 60 * 1000 },
      }), () => rmSync(scratch, { recursive: true, force: true }));
      expect(probe.status, `${probe.stdout}\n${probe.stderr}`).toBe("passed");
      expect(probe.exitCode).toBe(0);
      prepared.verify();
    } catch (error) {
      if (error instanceof FrozenArtifactContainerStateError) unresolved = error;
      throw error;
    } finally {
      // Unknown Docker state keeps all potentially mounted private trees owned.
      if (!unresolved) {
        prepared?.cleanup(); snapshot?.cleanup();
        rmSync(scratch, { recursive: true, force: true });
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
