import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPreparationOwnershipRecord, readPreparationOwnershipRecord } from
  "../preparation-ownership";

const directories: Array<() => void> = [];
afterEach(() => { for (const discard of directories.splice(0)) discard(); });

describe("durable preparation ownership", () => {
  it("survives a module reload and does not authorize deletion", async () => {
    const owned = createPreparationOwnershipRecord("/tmp/repository-owned-after-restart");
    directories.push(owned.discard);
    vi.resetModules();
    const fresh = await import("../preparation-ownership");
    expect(fresh.readPreparationOwnershipRecord(owned.directory)).toMatchObject({
      version: 1, workspacePath: "/tmp/repository-owned-after-restart",
    });
  });

  it("rejects a malformed ownership record", () => {
    const owned = createPreparationOwnershipRecord("/tmp/repository-owned-after-restart");
    directories.push(owned.discard);
    writeFileSync(join(owned.directory, "resources.json"), "{}");
    expect(() => readPreparationOwnershipRecord(owned.directory)).toThrow("Invalid preparation ownership record");
  });
});
