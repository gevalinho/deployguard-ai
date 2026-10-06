import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSandboxBuildAgent } from "@/lib/agents/sandbox-build-agent";
import { runSandboxTypecheckAgent } from "@/lib/agents/sandbox-typecheck-agent";
import { scanRepository } from "@/lib/scanner/repository-scanner";
import { calculateReadinessScore } from "@/lib/scoring/readiness-score";

vi.mock("@/lib/sandbox/docker-sandbox", () => ({
  runDockerSandboxCommand: vi.fn(async () => ({
    status: "passed", exitCode: 0, durationMs: 1, stdout: "", stderr: "",
  })),
}));

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function repository(options: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  files?: Record<string, string>;
}) {
  const root = mkdtempSync(join(tmpdir(), "deployguard-capability-"));
  fixtures.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "capability-fixture", version: "1.0.0", ...options,
  }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({
    name: "capability-fixture", version: "1.0.0", lockfileVersion: 3, packages: { "": {} },
  }));
  for (const [file, content] of Object.entries(options.files ?? {})) {
    const target = join(root, file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

describe("root Node capability and build applicability", () => {
  it("keeps a JavaScript Vite frontend build applicable and types not applicable", async () => {
    const root = repository({
      dependencies: { react: "*" }, devDependencies: { vite: "*" },
      scripts: { build: "vite build" }, files: { "src/App.jsx": "export default function App() {}" },
    });
    const scan = scanRepository(root);
    expect(scan.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "language", value: "JavaScript", evidence: [expect.objectContaining({ path: "src/App.jsx" })] }),
      expect.objectContaining({ key: "framework", value: "React", evidence: [expect.objectContaining({ path: "package.json" })] }),
      expect.objectContaining({ key: "tooling", value: "Vite", evidence: [expect.objectContaining({ path: "package.json" })] }),
      expect.objectContaining({ key: "runtime", value: "Node.js", evidence: [expect.objectContaining({ path: "package.json" })] }),
    ]));
    expect((await runSandboxTypecheckAgent(root)).skipReason).toBe("not_applicable");
    expect((await runSandboxBuildAgent(root, [], scan.facts)).status).toBe("passed");
  });

  it("keeps a TypeScript Vite frontend typecheck and build applicable", async () => {
    const root = repository({
      dependencies: { react: "*" }, devDependencies: { vite: "*", typescript: "*" },
      scripts: { build: "vite build" }, files: { "tsconfig.json": "{}", "src/App.tsx": "export default function App() {}" },
    });
    const scan = scanRepository(root);
    expect(scan.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "language", value: "TypeScript" }),
      expect.objectContaining({ key: "tooling", value: "Vite" }),
    ]));
    expect((await runSandboxTypecheckAgent(root)).status).toBe("passed");
    expect((await runSandboxBuildAgent(root, [], scan.facts)).status).toBe("passed");
  });

  it("excludes a verified interpreted JavaScript Express build from scoring", async () => {
    const root = repository({
      dependencies: { express: "*", mongoose: "*" },
      scripts: { start: "node src/server.js" }, files: { "src/server.js": "const express = require('express');" },
    });
    const scan = scanRepository(root);
    expect(scan.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "framework", value: "Express" }),
      expect.objectContaining({ key: "orm", value: "Mongoose", evidence: [expect.objectContaining({ path: "package.json" })] }),
      expect.objectContaining({ key: "databaseDriver", value: "MongoDB", evidence: [expect.objectContaining({ path: "package.json" })] }),
    ]));
    const build = await runSandboxBuildAgent(root, [], scan.facts);
    expect(build).toMatchObject({ status: "skipped", skipReason: "not_applicable" });
    const readiness = calculateReadinessScore([build, {
      id: "test", name: "Tests", category: "test", status: "passed", summary: "Passed",
    }]);
    expect(readiness.score).toBe(100);
    expect(readiness.applicableWeight).toBe(70);
    expect(readiness.notApplicableCategories).toContain("build");
  });

  it("does not exempt Express when the direct runtime entry is unproven", async () => {
    const root = repository({ dependencies: { express: "*" }, scripts: { start: "node src/missing.js" } });
    const build = await runSandboxBuildAgent(root);
    expect(build).toMatchObject({ status: "skipped", skipReason: "not_configured" });
  });

  it("keeps a TypeScript Express compilation build applicable", async () => {
    const root = repository({
      dependencies: { express: "*", mongoose: "*" }, devDependencies: { typescript: "*" },
      scripts: { build: "tsc", start: "node dist/server.js" }, files: { "tsconfig.json": "{}", "src/server.ts": "export {}" },
    });
    expect((await runSandboxBuildAgent(root)).status).toBe("passed");
  });

  it("preserves Next.js build behavior", async () => {
    const root = repository({
      dependencies: { next: "*", react: "*", express: "*" },
      scripts: { build: "next build", start: "node server.js" },
      files: { "next.config.js": "module.exports = {}", "server.js": "require('express')" },
    });
    expect((await runSandboxBuildAgent(root)).status).toBe("passed");
  });

  it("does not exempt a combined React and Express root package", async () => {
    const root = repository({
      dependencies: { react: "*", express: "*" },
      scripts: { start: "node server.js" }, files: { "server.js": "require('express')" },
    });
    expect((await runSandboxBuildAgent(root)).skipReason).toBe("not_configured");
  });

  it("does not exempt a Next.js package without a build script", async () => {
    const root = repository({
      dependencies: { next: "*", express: "*" },
      scripts: { start: "node server.js" }, files: { "server.js": "require('express')" },
    });
    expect((await runSandboxBuildAgent(root)).skipReason).toBe("not_configured");
  });
});
