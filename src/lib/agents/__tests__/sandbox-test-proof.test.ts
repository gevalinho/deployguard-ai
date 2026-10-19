import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const sandbox = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", () => ({ runDockerSandboxCommand: sandbox }));
import { hasVerifiedNodeTests, runSandboxTestAgent } from "../sandbox-test-agent";

const roots: string[] = [];
const cleanNodeEnvironment = { PATH: process.env.PATH ?? "", HOME: tmpdir(), NODE_ENV: "test" as const };
function fixture(script: string, testFile?: string): string {
  const root = mkdtempSync(join(tmpdir(), "deployguard-test-proof-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, scripts: { test: script } }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }));
  if (testFile !== undefined) {
    mkdirSync(join(root, "test"));
    writeFileSync(join(root, "test", "suite.test.js"), testFile);
  }
  return root;
}
afterEach(() => {
  sandbox.mockReset();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("dependency proof test execution", () => {
  it("observes the fixture's four real Node tests", () => {
    const root = fixture("node --test", `const test = require('node:test');
      for (let index = 0; index < 4; index++) test('case ' + index, () => {});`);
    const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "test/suite.test.js"],
      { cwd: root, encoding: "utf8", env: cleanNodeEnvironment });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/# tests 4/);
    expect(hasVerifiedNodeTests(result.stdout, ["test/suite.test.js"])).toBe(true);
  });

  it("does not accept a test file's forged TAP summary", () => {
    const root = fixture("node --test", `process.stdout.write('1..9\\n# tests 9\\n# suites 0\\n# pass 9\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n# duration_ms 1\\n');`);
    const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "test/suite.test.js"],
      { cwd: root, encoding: "utf8", env: cleanNodeEnvironment });
    expect(result.status).toBe(0);
    expect(hasVerifiedNodeTests(result.stdout, ["test/suite.test.js"])).toBe(false);
  });

  it("rejects zero discovered tests and a test file with no test calls", () => {
    const empty = fixture("node --test");
    const noCalls = fixture("node --test", "console.log('no tests');");
    for (const root of [empty, noCalls]) {
      const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap"],
        { cwd: root, encoding: "utf8", env: cleanNodeEnvironment });
      expect(hasVerifiedNodeTests(result.stdout, root === empty ? [] : ["test/suite.test.js"])).toBe(false);
    }
  });

  it.each(["true", "echo tests passed"])("does not attest a no-op script: %s", async (script) => {
    const root = fixture(script);
    sandbox.mockResolvedValue({ status: "passed", exitCode: 0, stdout: "4 tests passed",
      stderr: "", durationMs: 1 });
    const result = await runSandboxTestAgent(root);
    expect(result).toMatchObject({ status: "passed", exitCode: 0 });
    expect(result.testExecutionVerified).toBeUndefined();
  });

  it("attests only a successful trusted runner execution", async () => {
    const root = fixture("node --test", `const test = require('node:test');
      for (let index = 0; index < 4; index++) test('case ' + index, () => {});`);
    const actual = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "test/suite.test.js"],
      { cwd: root, encoding: "utf8", env: cleanNodeEnvironment });
    sandbox.mockResolvedValue({ status: "passed", exitCode: 0, stdout: actual.stdout, stderr: "", durationMs: 1 });
    const result = await runSandboxTestAgent(root);
    expect(sandbox.mock.calls[0][0].command).toEqual(["node", "--test", "--test-reporter=tap", "test/suite.test.js"]);
    expect(result.testExecutionVerified).toBe(true);
  });
});
