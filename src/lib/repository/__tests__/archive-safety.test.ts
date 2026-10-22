import { gzipSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectRepositoryArchive } from "../archive-safety";
import { createAssessmentExecutionContext, runAssessmentStage } from
  "@/lib/orchestration/assessment-execution";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function archive(name: string, size: number, type = "0"): string {
  const root = mkdtempSync(join(tmpdir(), "deployguard-archive-test-"));
  roots.push(root);
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write(type, 156, "ascii");
  const path = join(root, "repository.tar.gz");
  writeFileSync(path, gzipSync(Buffer.concat([header, Buffer.alloc(1024)])));
  return path;
}

describe("repository archive preflight", () => {
  it("accepts a bounded regular entry", async () => {
    await expect(inspectRepositoryArchive(archive("owner-repo/file.txt", 0))).resolves.toBeUndefined();
  });
  it("rejects path traversal and links before extraction", async () => {
    await expect(inspectRepositoryArchive(archive("owner-repo/../escape", 0))).rejects.toThrow("archive_path_rejected");
    await expect(inspectRepositoryArchive(archive("owner-repo/link", 0, "2"))).rejects.toThrow("archive_entry_type_rejected");
  });
  it("rejects an expanded size above the configured limit", async () => {
    await expect(inspectRepositoryArchive(archive("owner-repo/huge", 512 * 1024 * 1024 + 1)))
      .rejects.toThrow("archive_expansion_limit");
  });
  it("stops archive inspection when repository ingestion is cancelled", async () => {
    const context = createAssessmentExecutionContext();
    const path = archive("owner-repo/file.txt", 0);
    const pending = context.run(() => runAssessmentStage("repository", () => inspectRepositoryArchive(path)));
    context.cancel("user_requested");
    await expect(pending).rejects.toMatchObject({ name: "AssessmentCancelledError" });
    context.dispose();
  });
});
