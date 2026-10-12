import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const docker = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", () => ({ runDockerSandboxCommand: docker }));

import { runSandboxBuildAgent } from "../sandbox-build-agent";
import { calculateReadinessScore } from "@/lib/scoring/readiness-score";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
  docker.mockReset();
});

it("blocks an unresolved Google Font declaration before Docker and earns no build credit", async () => {
  root = await mkdtemp(join(tmpdir(), "deployguard-unsafe-font-"));
  await mkdir(join(root, "app"));
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "unsafe-font-fixture", version: "1.0.0", scripts: { build: "next build --webpack" },
    dependencies: { next: "16.4.0" },
  }));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({
    name: "unsafe-font-fixture", version: "1.0.0", lockfileVersion: 3,
    packages: { "": { name: "unsafe-font-fixture", version: "1.0.0" } },
  }));
  await writeFile(join(root, "app", "layout.js"),
    'import { Geist } from "next/font/google"; const options = { subsets: ["latin"] }; Geist(options);');

  const result = await runSandboxBuildAgent(root);
  expect(result.status).toBe("blocked");
  expect(result.exitCode).toBeUndefined();
  expect(result.summary).toContain("could not be safely resolved");
  expect(docker).not.toHaveBeenCalled();

  const score = calculateReadinessScore([result]);
  expect(score.breakdown.find((item) => item.category === "build"))
    .toMatchObject({ status: "blocked", earnedWeight: 0, evaluated: false });
  expect(score.coverage).toBe(0);
});
