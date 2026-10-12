import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const docker = vi.hoisted(() => vi.fn());
const prepare = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", () => ({ runDockerSandboxCommand: docker }));
vi.mock("@/lib/sandbox/next-google-font-assets", () => ({ prepareNextGoogleFonts: prepare }));

import { runSandboxBuildAgent } from "../sandbox-build-agent";
import { calculateReadinessScore } from "@/lib/scoring/readiness-score";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.length = 0;
  docker.mockReset();
  prepare.mockReset();
});

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "deployguard-build-assets-"));
  roots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "build-asset-test", version: "1.0.0", scripts: { build: "next build" },
    dependencies: { next: "16.4.0" },
  }));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({
    name: "build-asset-test", version: "1.0.0", lockfileVersion: 3,
    packages: { "": { name: "build-asset-test", version: "1.0.0" } },
  }));
  return root;
}

describe("production build asset handoff", () => {
  it("runs the real build offline with a read-only font mount and awards full build weight on success", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    prepare.mockResolvedValue({ status: "ready", mount: {
      source: "/controlled/assets", target: "/deployguard-build-assets", readOnly: true,
    }, environment: { NEXT_FONT_GOOGLE_MOCKED_RESPONSES: "/deployguard-build-assets/fonts.js" },
    cleanup });
    docker.mockResolvedValue({ status: "passed", exitCode: 0,
      stdout: "Production build completed", stderr: "", durationMs: 10 });
    const result = await runSandboxBuildAgent(await repository());
    expect(result.status).toBe("passed");
    expect(result.summary).toBe("Production build passed inside the sandbox.");
    expect(docker).toHaveBeenCalledWith(expect.objectContaining({ network: "none",
      mounts: [expect.objectContaining({ target: "/deployguard-build-assets", readOnly: true })],
      environment: expect.objectContaining({
        NEXT_FONT_GOOGLE_MOCKED_RESPONSES: "/deployguard-build-assets/fonts.js",
      }),
    }));
    expect(cleanup).toHaveBeenCalledOnce();
    expect(calculateReadinessScore([result]).breakdown.find((item) => item.category === "build"))
      .toMatchObject({ status: "passed", earnedWeight: 30 });
  });

  it("blocks when approved assets cannot be safely provided without running repository code", async () => {
    prepare.mockResolvedValue({ status: "blocked",
      reason: "Approved Google Font assets failed validation or exceeded download limits." });
    const result = await runSandboxBuildAgent(await repository());
    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("Google Font assets failed validation");
    expect(docker).not.toHaveBeenCalled();
    const score = calculateReadinessScore([result]);
    expect(score.breakdown.find((item) => item.category === "build"))
      .toMatchObject({ status: "blocked", earnedWeight: 0, evaluated: false });
    expect(score.coverage).toBe(0);
  });

  it("cleans staged assets even if sandbox execution throws", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    prepare.mockResolvedValue({ status: "ready", mount: {
      source: "/controlled/assets", target: "/deployguard-build-assets", readOnly: true,
    }, environment: { NEXT_FONT_GOOGLE_MOCKED_RESPONSES: "/deployguard-build-assets/fonts.js" },
    cleanup });
    docker.mockRejectedValue(new Error("sandbox execution failed"));
    await expect(runSandboxBuildAgent(await repository())).rejects.toThrow("sandbox execution failed");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("blocks an unprepared font variant without exposing its URL in evidence", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    prepare.mockResolvedValue({ status: "ready", mount: {
      source: "/controlled/assets", target: "/deployguard-build-assets", readOnly: true,
    }, environment: { NEXT_FONT_GOOGLE_MOCKED_RESPONSES: "/deployguard-build-assets/fonts.js" },
    cleanup });
    docker.mockResolvedValue({ status: "failed", exitCode: 1,
      stdout: "Missing mocked response for URL: https://fonts.googleapis.com/css2?family=Secret",
      stderr: "", durationMs: 10 });
    const result = await runSandboxBuildAgent(await repository());
    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("Google Font variant");
    expect(result.evidence).toBeUndefined();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("keeps unrelated external asset failures blocked without enabling build networking", async () => {
    prepare.mockResolvedValue({ status: "not_required" });
    docker.mockResolvedValue({ status: "failed", exitCode: 1,
      stdout: "", stderr: "Failed to fetch external asset", durationMs: 10 });
    const result = await runSandboxBuildAgent(await repository());
    expect(result.status).toBe("blocked");
    expect(docker).toHaveBeenCalledWith(expect.objectContaining({ network: "none" }));
  });
});
