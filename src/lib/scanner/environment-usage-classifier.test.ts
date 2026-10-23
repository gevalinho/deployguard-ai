import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPreparationPlan } from "@/lib/sandbox/preparation-planner";
import type { RepositoryFact } from "@/lib/evidence/types";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function fixture(db: string, route = "export { GET, POST } from 'app/auth';") {
  const root = mkdtempSync(join(tmpdir(), "deployguard-env-test-"));
  directories.push(root);
  for (const [path, source] of [
    ["app/api/auth/[...nextauth]/route.ts", route],
    ["app/auth.ts", "import { getUser } from 'app/db'; export const GET = getUser;"],
    ["app/db.ts", db],
  ]) {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, source);
  }
  return root;
}

function fact(variable: string): RepositoryFact {
  return { key: "environmentVariable", value: variable, confidence: 0.9,
    evidence: [{ source: "file", path: "app/db.ts", description: "Environment reference" }] };
}

describe("Next.js auth route build environment", () => {
  it("requires POSTGRES_URL with the static import-chain paths", () => {
    const root = fixture("import postgres from 'postgres'; let client = postgres(`${process.env.POSTGRES_URL!}?sslmode=require`);");
    const requirement = createPreparationPlan([fact("POSTGRES_URL")], root).requirements.find((item) => item.technology === "POSTGRES_URL");
    expect(requirement?.phase).toBe("build");
    expect(requirement?.required).toBe(true);
    expect(requirement?.evidencePaths).toContain("app/api/auth/[...nextauth]/route.ts");
    expect(requirement?.evidencePaths).toContain("app/auth.ts");
    expect(requirement?.evidencePaths).toContain("app/db.ts");
  });

  it("keeps reads inside a function out of the build requirement", () => {
    const root = fixture("export function getUser() { return process.env.POSTGRES_URL; }");
    expect(createPreparationPlan([fact("POSTGRES_URL")], root).requirements.find((item) => item.technology === "POSTGRES_URL")?.phase).toBe("unknown");
  });

  it("does not infer a build requirement without the route import", () => {
    const root = fixture("let client = postgres(process.env.POSTGRES_URL);", "export const GET = () => null;");
    expect(createPreparationPlan([fact("POSTGRES_URL")], root).requirements.find((item) => item.technology === "POSTGRES_URL")?.phase).toBe("unknown");
  });

  it("does not classify other database variables as build required", () => {
    const root = fixture("let client = postgres(process.env.POSTGRES_URL);");
    expect(createPreparationPlan([fact("DATABASE_URL")], root).requirements.find((item) => item.technology === "DATABASE_URL")?.phase).toBe("unknown");
  });
});
