import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFrozenSourceSnapshot } from "./frozen-source-snapshot";
import { prepareFrozenNpmDependencies } from "./frozen-dependency-preparation";
import { runDockerSandboxCommand } from "@/lib/sandbox/docker-sandbox";
import { FrozenArtifactContainerStateError } from "./frozen-artifact-ownership";
import { runOwnedDependencyPreparationProbe } from "./frozen-dependency-preparation.integration-probe";

const run = process.env.DEPLOYGUARD_DOCKER_INTEGRATION === "1" ? it : it.skip;
describe("real Node 22 frozen dependency preparation", () => {
  run("installs frozen lodash and runs the fixture's four tests offline", async () => {
    const root = mkdtempSync(join(tmpdir(), "deployguard-prep-real-"));
    let snapshot: ReturnType<typeof createFrozenSourceSnapshot> | undefined;
    let prepared: Awaited<ReturnType<typeof prepareFrozenNpmDependencies>> | undefined;
    let unresolved: FrozenArtifactContainerStateError | undefined;
    const cleanupMounted = () => { prepared?.cleanup(); snapshot?.cleanup(); };
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
      writeFileSync(join(root, "test", "lodash.test.js"), `const test = require('node:test');
        const _ = require('lodash');
        for (let index = 0; index < 4; index++) test('lodash case ' + index, () => {
          if (_.get({ value: index }, 'value') !== index) throw new Error('wrong value');
        });`);
      snapshot = createFrozenSourceSnapshot(root);
      prepared = await prepareFrozenNpmDependencies(snapshot, snapshot.identity);
      prepared.verify();
      expect(existsSync(join(dirname(prepared.path), "SHOULD_NOT_RUN"))).toBe(false);
      const result = await runOwnedDependencyPreparationProbe(snapshot.path, prepared.path,
        () => runDockerSandboxCommand({ repositoryPath: snapshot!.path,
        command: ["node", "--test", "/workspace/test/lodash.test.js"],
        user: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        environment: { NODE_PATH: "/deps" },
        network: "none", mounts: [
          { source: prepared!.path, target: "/deps", readOnly: true },
        ] }), cleanupMounted);
      // The dependency mount is read-only. The shared runner still mounts /workspace writable;
      // this test does not establish a read-only Docker source mount.
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe("passed");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("# tests 4");
      const readOnlyProbe = await runOwnedDependencyPreparationProbe(snapshot.path, prepared.path,
        () => runDockerSandboxCommand({ repositoryPath: snapshot!.path,
        command: ["node", "-e", "const fs=require('node:fs'); try { fs.writeFileSync('/deps/_write_probe','x'); process.exit(1); } catch (error) { if (error.code !== 'EROFS' && error.code !== 'EACCES') process.exit(2); }"],
        user: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        network: "none", mounts: [{ source: prepared!.path, target: "/deps", readOnly: true }],
      }), cleanupMounted);
      expect(readOnlyProbe.status, readOnlyProbe.stderr).toBe("passed");
      prepared.verify();
    } catch (error) {
      if (error instanceof FrozenArtifactContainerStateError) {
        unresolved = error;
        console.error("[DeployGuard Dependency Preparation Probe] Docker state unknown; mounted artifacts retained.",
          { containerId: error.containerId ?? "unavailable", artifacts: error.artifacts });
      }
      throw error;
    } finally {
      if (!unresolved) cleanupMounted();
      // The original fixture input is never mounted; frozen artifacts stay owned.
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
