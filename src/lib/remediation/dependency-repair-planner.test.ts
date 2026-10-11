import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as semver from "semver";
import { afterEach, describe, expect, it } from "vitest";
import { planDependencyRepair } from "./dependency-repair-planner";

const directories: string[] = [];

async function repository(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string> = {},
) {
  const path = await mkdtemp(join(tmpdir(), "deployguard-planner-"));
  directories.push(path);

  await writeFile(
    join(path, "package.json"),
    JSON.stringify({ dependencies, devDependencies }),
  );

  const packages: Record<string, { version?: string }> = {
    "": {},
  };

  for (const [name, version] of Object.entries({
    ...dependencies,
    ...devDependencies,
  })) {
    const installedVersion = semver.minVersion(version)?.version;

    if (installedVersion) {
      packages[`node_modules/${name}`] = {
        version: installedVersion,
      };
    }
  }

  await writeFile(
    join(path, "package-lock.json"),
    JSON.stringify({
      name: "deployguard-planner-test",
      lockfileVersion: 3,
      packages,
    }),
  );

  return path;
}

afterEach(async () => {
  for (const path of directories) {
    await rm(path, { recursive: true, force: true });
  }
  directories.length = 0;
});

const proposal = {
  packageName: "braces",
  advisoryId: "12345",
  strategy: "dependency_security",
  risk: "safe",
} as Parameters<typeof planDependencyRepair>[1];

function audit(fixAvailable: unknown) {
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {
      braces: {
        name: "braces",
        severity: "high",
        isDirect: true,
        via: [
          {
            name: "braces",
            severity: "high",
            source: 12345,
          },
        ],
        effects: [],
        range: "<3.0.3",
        nodes: ["node_modules/braces"],
        fixAvailable,
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 1,
        critical: 0,
        total: 1,
      },
    },
  });
}

describe("targeted dependency repair planner", () => {
  it("rejects missing baseline audit", async () => {
    const path = await repository({ braces: "3.0.2" });

    const result = await planDependencyRepair(path, proposal, "");

    expect(result.supported).toBe(false);
  });

  it("rejects transitive dependencies", async () => {
    const path = await repository({ express: "4.18.2" });

    const result = await planDependencyRepair(
      path,
      proposal,
      audit({
        name: "braces",
        version: "3.0.3",
        isSemVerMajor: false,
      }),
    );

    expect(result.supported).toBe(false);
  });

  it("rejects missing explicit fix versions", async () => {
    const path = await repository({ braces: "3.0.2" });

    const result = await planDependencyRepair(path, proposal, audit(true));

    expect(result.supported).toBe(false);
  });

  it("rejects major upgrades without approval", async () => {
    const path = await repository({ braces: "2.3.2" });

    const result = await planDependencyRepair(
      path,
      proposal,
      audit({
        name: "braces",
        version: "3.0.3",
        isSemVerMajor: true,
      }),
    );

    expect(result.supported).toBe(false);
  });

  it("creates a targeted command for a supported direct dependency", async () => {
    const path = await repository({ braces: "3.0.2" });

    const result = await planDependencyRepair(
      path,
      proposal,
      audit({
        name: "braces",
        version: "3.0.3",
        isSemVerMajor: false,
      }),
    );

    expect(result.supported).toBe(true);

    if (result.supported) {
      expect(result.command).toContain("braces@3.0.3");
      expect(result.command).not.toContain("audit");
      expect(result.command).not.toContain("--force");
    }
  });

  it("preserves development dependency classification", async () => {
    const path = await repository({}, { braces: "3.0.2" });

    const result = await planDependencyRepair(
      path,
      proposal,
      audit({
        name: "braces",
        version: "3.0.3",
        isSemVerMajor: false,
      }),
    );

    expect(result.supported).toBe(true);

    if (result.supported) {
      expect(result.command).toContain("--save-dev");
      expect(result.command).not.toContain("--save-prod");
    }
  });

  it("rejects packages declared in both dependency sections", async () => {
    const path = await repository({ braces: "3.0.2" }, { braces: "3.0.2" });

    const result = await planDependencyRepair(
      path,
      proposal,
      audit({
        name: "braces",
        version: "3.0.3",
        isSemVerMajor: false,
      }),
    );

    expect(result.supported).toBe(false);
  });

  it("rejects a fix equal to the installed version", async () => {
    const path = await repository({ braces: "3.0.2" });

    const result = await planDependencyRepair(
      path,
      proposal,
      audit({
        name: "braces",
        version: "3.0.2",
        isSemVerMajor: false,
      }),
    );

    expect(result.supported).toBe(false);

    if (!result.supported) {
      expect(result.reason).toContain(
        "must be newer than the installed version",
      );
    }
  });

  it("rejects a downgrade from the installed version", async () => {
    const path = await repository({ braces: "3.0.2" });

    const result = await planDependencyRepair(
      path,
      proposal,
      audit({
        name: "braces",
        version: "3.0.1",
        isSemVerMajor: false,
      }),
    );

    expect(result.supported).toBe(false);

    if (!result.supported) {
      expect(result.reason).toContain(
        "must be newer than the installed version",
      );
    }
  });
});
