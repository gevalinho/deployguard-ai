import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { runDockerMock } = vi.hoisted(() => ({
  runDockerMock: vi.fn(),
}));

vi.mock("@/lib/sandbox/docker-sandbox", () => ({
  runDockerSandboxCommand: runDockerMock,
}));

import { runSandboxTypecheckAgent } from "../sandbox-typecheck-agent";
import { runSandboxLintAgent } from "../sandbox-lint-agent";
import { runSandboxTestAgent } from "../sandbox-test-agent";
import { runSandboxBuildAgent } from "../sandbox-build-agent";

const temporaryDirectories: string[] = [];

function createRepository(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "deployguard-infrastructure-test-")
  );

  temporaryDirectories.push(directory);

  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "infrastructure-test",
      version: "1.0.0",
      scripts: {
        typecheck: "tsc --noEmit",
        lint: "eslint .",
        test: "vitest run",
        build: "node build.js",
      },
    })
  );

  writeFileSync(
    join(directory, "package-lock.json"),
    JSON.stringify({
      name: "infrastructure-test",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {},
    })
  );

  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true } })
  );

  return directory;
}

afterEach(() => {
  vi.clearAllMocks();

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("sandbox agents handle Docker infrastructure failures", () => {
  const agents = [
    ["TypeScript", runSandboxTypecheckAgent],
    ["Lint", runSandboxLintAgent],
    ["Tests", runSandboxTestAgent],
    ["Build", runSandboxBuildAgent],
  ] as const;

  it.each(agents)(
    "%s reports infrastructure failure without exposing Docker output",
    async (_name, runAgent) => {
      runDockerMock.mockResolvedValue({
        status: "infrastructure_error",
        exitCode: 125,
        durationMs: 10,
        stdout: "",
        stderr: "Docker daemon unavailable token=private-secret",
      });

      const result = await runAgent(createRepository());

      expect(runDockerMock).toHaveBeenCalledOnce();
      expect(result.status).toBe("error");
      expect(result.exitCode).toBe(125);
      expect(result.summary).toContain("Docker infrastructure");
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("private-secret");
    }
  );
});
