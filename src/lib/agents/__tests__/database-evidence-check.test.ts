import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabaseEvidenceCheck } from "../database-evidence-check";
import { runDatabaseAgent } from "../database-agent";
import { scanRepository } from "@/lib/scanner/repository-scanner";
import { calculateReadinessScore } from "@/lib/scoring/readiness-score";
import { calculateReadinessVerdict } from "@/lib/scoring/readiness-verdict";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "deployguard-database-evidence-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return scanRepository(root);
}

describe("database evidence classification", () => {
  it("keeps a static-looking repository unknown without proof of database absence", async () => {
    const scan = repository({ "index.html": "<h1>Static page</h1>", "style.css": "h1 { color: blue; }" });
    const check = createDatabaseEvidenceCheck(scan);
    expect(check).toMatchObject({ category: "database", status: "skipped" });
    expect(check.skipReason).toBeUndefined();
    expect((await runDatabaseAgent(scan)).skipReason).toBeUndefined();
    expect(calculateReadinessVerdict([check], calculateReadinessScore([check])).status)
      .toBe("undetermined");
  });

  it("reports a detected database integration as required but unverified", () => {
    const scan = repository({ "package.json": JSON.stringify({ dependencies: { pg: "1.0.0" } }) });
    expect(scan.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "databaseDriver", value: "PostgreSQL" }),
    ]));
    const check = createDatabaseEvidenceCheck(scan);
    expect(check).toMatchObject({ category: "database", status: "skipped", skipReason: "unsupported" });
    expect(calculateReadinessVerdict([check], calculateReadinessScore([check])).status)
      .toBe("undetermined");
  });

  it("recognizes a Prisma datasource as positive evidence without claiming validation", () => {
    const scan = repository({ "prisma/schema.prisma":
      'datasource db { provider = "postgresql" url = env("DATABASE_URL") }' });
    expect(scan.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "orm", value: "Prisma" }),
      expect.objectContaining({ key: "database", value: "PostgreSQL" }),
    ]));
    expect(createDatabaseEvidenceCheck(scan).skipReason).toBe("unsupported");
  });

  it("does not interpret ambiguous package metadata as non-applicability", () => {
    const scan = repository({ "package.json": JSON.stringify({ name: "unknown-integration" }) });
    expect(createDatabaseEvidenceCheck(scan)).toMatchObject({ status: "skipped" });
    expect(createDatabaseEvidenceCheck(scan).skipReason).toBeUndefined();
  });
});
