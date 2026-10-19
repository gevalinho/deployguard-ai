import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const reconcile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sandbox/docker-sandbox", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sandbox/docker-sandbox")>(),
  reconcileSandboxContainer: reconcile,
}));

import { SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";
import { assertArtifactCanBeDeleted, FrozenArtifactContainerStateError } from "./frozen-artifact-ownership";
import { runOwnedDependencyPreparationProbe } from "./frozen-dependency-preparation.integration-probe";

const roots: string[] = [];
function mounts() {
  const root = mkdtempSync(join(tmpdir(), "deployguard-prep-probe-"));
  roots.push(root);
  const source = join(root, "source");
  const dependencies = join(root, "dependencies");
  mkdirSync(source);
  mkdirSync(dependencies);
  const cleanup = vi.fn(() => {
    assertArtifactCanBeDeleted(source);
    assertArtifactCanBeDeleted(dependencies);
    rmSync(root, { recursive: true, force: true });
  });
  return { root, source, dependencies, cleanup };
}
afterEach(() => {
  reconcile.mockReset();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("dependency-preparation integration probe ownership", () => {
  it("leases both mounts during each successful Docker probe", async () => {
    const { source, dependencies, cleanup } = mounts();
    for (let probe = 0; probe < 2; probe++) {
      await runOwnedDependencyPreparationProbe(source, dependencies, async () => {
        expect(() => assertArtifactCanBeDeleted(source)).toThrow();
        expect(() => assertArtifactCanBeDeleted(dependencies)).toThrow();
      }, cleanup);
      expect(() => assertArtifactCanBeDeleted(source)).not.toThrow();
      expect(() => assertArtifactCanBeDeleted(dependencies)).not.toThrow();
    }
    expect(cleanup).not.toHaveBeenCalled();
    cleanup();
  });

  it.each(["test execution", "read-only probe"])(
    "retains both mounts after unknown state in %s until the original ID is reconciled",
    async (which) => {
      const { root, source, dependencies, cleanup } = mounts();
      if (which === "read-only probe")
        await runOwnedDependencyPreparationProbe(source, dependencies, async () => undefined, cleanup);
      const containerId = "a".repeat(64);
      const unknown = new SandboxContainerStateUnknownError("Docker inspection failed.",
        "deployguard-probe", containerId);
      const error = await runOwnedDependencyPreparationProbe(source, dependencies,
        async () => { throw unknown; }, cleanup).catch((caught) => caught);
      expect(error).toBeInstanceOf(FrozenArtifactContainerStateError);
      expect(error.artifacts).toEqual([source, dependencies]);
      expect(() => cleanup()).toThrow();
      expect(existsSync(root)).toBe(true);

      reconcile.mockRejectedValueOnce(new SandboxContainerStateUnknownError("Inspection unavailable."));
      await expect(error.reconcile()).rejects.toThrow("Inspection unavailable.");
      expect(cleanup).not.toHaveReturned();
      expect(existsSync(root)).toBe(true);
      expect(reconcile.mock.calls[0][0]).toMatchObject({ containerId });

      reconcile.mockResolvedValueOnce(undefined);
      await error.reconcile();
      expect(reconcile.mock.calls[1][0]).toMatchObject({ containerId });
      expect(existsSync(root)).toBe(false);
      expect(() => assertArtifactCanBeDeleted(source)).not.toThrow();
      expect(() => assertArtifactCanBeDeleted(dependencies)).not.toThrow();
    },
  );
});
