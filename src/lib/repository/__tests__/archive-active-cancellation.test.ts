import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ input: null as PassThrough | null,
  unzip: null as PassThrough | null }));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  createReadStream: () => mocks.input,
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  stat: async () => ({ size: 1 }),
}));
vi.mock("node:zlib", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:zlib")>(),
  createGunzip: () => mocks.unzip,
}));

import { inspectRepositoryArchive } from "../archive-safety";
import { createAssessmentExecutionContext, runAssessmentStage } from
  "@/lib/orchestration/assessment-execution";

describe("active archive stream cancellation", () => {
  it("destroys an active stream and stops repository ingestion", async () => {
    mocks.input = new PassThrough();
    mocks.unzip = new PassThrough();
    const context = createAssessmentExecutionContext();
    const pending = context.run(() => runAssessmentStage("repository", () =>
      inspectRepositoryArchive("/tmp/controlled-archive")));
    const assertion = expect(pending).rejects.toMatchObject({ name: "AssessmentCancelledError" });
    await vi.waitFor(() => expect(mocks.input?.listenerCount("data")).toBeGreaterThan(0));
    expect(context.cancel("user_requested")).toBe(true);
    await assertion;
    expect(mocks.input.destroyed).toBe(true);
    expect(mocks.unzip.destroyed).toBe(true);
    context.dispose();
  });
});
