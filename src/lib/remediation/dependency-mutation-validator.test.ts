import { describe, expect, it } from "vitest";
import { validateDependencyMutation } from "./dependency-mutation-validator";
import type { VerifiedPatch } from "./verified-patch";

const target = "braces";
const version = "3.0.3";

type TestManifest = {
  name: string;
  version: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
};

type TestLockPackage = {
  name?: string;
  version: string;
  dependencies?: Record<string, string>;
  resolved?: string;
  integrity?: string;
  license?: string;
  engines?: Record<string, string>;
};

type TestLock = {
  name: string;
  version: string;
  lockfileVersion: number;
  packages: Record<string, TestLockPackage>;
};

function fixture(
  modify?: (manifest: TestManifest, lock: TestLock) => void,
): VerifiedPatch {
  const before = {
    name: "test-project",
    version: "1.0.0",
    scripts: { test: "vitest" },
    dependencies: {
      braces: "3.0.2",
      lodash: "4.17.21",
    },
  };

  const after = structuredClone(before);
  after.dependencies.braces = version;

  const lock = {
    name: "test-project",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          braces: version,
          lodash: "4.17.21",
        },
      },
      "node_modules/braces": {
        version,
        resolved: "https://registry.npmjs.org/braces/-/braces-3.0.3.tgz",
      },
      "node_modules/lodash": {
        version: "4.17.21",
      },
    },
  };

  const beforeLock = structuredClone(lock);
  beforeLock.packages[""].dependencies.braces = "3.0.2";
  beforeLock.packages["node_modules/braces"].version = "3.0.2";
  beforeLock.packages["node_modules/braces"].resolved =
    "https://registry.npmjs.org/braces/-/braces-3.0.2.tgz";

  modify?.(after, lock);

  return {
    fileCount: 2,
    files: [
      {
        path: "package.json",
        changeType: "modified",
        before: JSON.stringify(before),
        after: JSON.stringify(after),
      },
      {
        path: "package-lock.json",
        changeType: "modified",
        before: JSON.stringify(beforeLock),
        after: JSON.stringify(lock),
      },
    ],
  };
}

describe("targeted dependency mutation validation", () => {
  it("accepts an authorized direct dependency update", () => {
    expect(validateDependencyMutation(fixture(), target, version).valid).toBe(
      true,
    );
  });

  it("rejects an unrelated direct dependency update", () => {
    const patch = fixture((manifest) => {
      manifest.dependencies.lodash = "4.17.22";
    });

    expect(validateDependencyMutation(patch, target, version).valid).toBe(
      false,
    );
  });

  it("rejects modified package scripts", () => {
    const patch = fixture((manifest) => {
      manifest.scripts.test = "node unexpected.js";
    });

    expect(validateDependencyMutation(patch, target, version).valid).toBe(
      false,
    );
  });

  it("rejects a mismatched lockfile version", () => {
    const patch = fixture((_manifest, lock) => {
      lock.packages["node_modules/braces"].version = "3.0.4";
    });

    expect(validateDependencyMutation(patch, target, version).valid).toBe(
      false,
    );
  });

  it("rejects changes to unrelated repository files", () => {
    const patch = fixture();
    patch.files.push({
      path: "src/index.ts",
      changeType: "modified",
      before: "export const value = 1;",
      after: "export const value = 2;",
    });
    patch.fileCount = patch.files.length;

    expect(validateDependencyMutation(patch, target, version).valid).toBe(
      false,
    );
  });

  it("rejects missing dependency lockfile changes", () => {
    const patch = fixture();
    patch.files = patch.files.filter(
      (file) => file.path !== "package-lock.json",
    );
    patch.fileCount = patch.files.length;

    expect(validateDependencyMutation(patch, target, version).valid).toBe(
      false,
    );
  });

  it("rejects duplicate dependency patch entries", () => {
    const patch = fixture();

    patch.files.push(structuredClone(patch.files[0]));
    patch.fileCount = patch.files.length;

    const result = validateDependencyMutation(patch, target, version);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain(
      "exactly one manifest and one lockfile change",
    );
  });
});

describe("lockfile mutation authorization", () => {
  it("rejects an unrelated installed dependency version change", () => {
    const patch = fixture((_manifest, lock) => {
      lock.packages["node_modules/lodash"].version = "4.17.22";
    });

    expect(validateDependencyMutation(patch, target, version).valid).toBe(
      false,
    );
  });

  it("rejects unexpected dependency package additions", () => {
    const patch = fixture((_manifest, lock) => {
      lock.packages["node_modules/unexpected-package"] = {
        version: "1.0.0",
      };
    });

    expect(validateDependencyMutation(patch, target, version).valid).toBe(
      false,
    );
  });
});

describe("lockfile metadata integrity", () => {
  it("rejects missing original and updated resolved URLs", () => {
    const patch = fixture();

    const lockChange = patch.files.find(
      (file) => file.path === "package-lock.json",
    );

    if (!lockChange?.before || !lockChange.after) {
      throw new Error("Missing lockfile fixture.");
    }

    const before = JSON.parse(lockChange.before);
    const after = JSON.parse(lockChange.after);

    delete before.packages["node_modules/braces"].resolved;
    delete after.packages["node_modules/braces"].resolved;

    lockChange.before = JSON.stringify(before);
    lockChange.after = JSON.stringify(after);

    const result = validateDependencyMutation(patch, target, version);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("cannot be verified");
  });

  it("rejects non-string resolved metadata", () => {
    const patch = fixture((_manifest, lock) => {
      (
        lock.packages["node_modules/braces"] as Record<string, unknown>
      ).resolved = 12345;
    });

    const result = validateDependencyMutation(patch, target, version);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("cannot be verified");
  });

  it("rejects embedded credentials in dependency URLs", () => {
    const patch = fixture((_manifest, lock) => {
      lock.packages["node_modules/braces"].resolved =
        "https://user:password@registry.npmjs.org/braces/-/braces-3.0.3.tgz";
    });

    const result = validateDependencyMutation(patch, target, version);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("unauthorized");
  });
  it("rejects an unauthorized integrity hash change", () => {
    const patch = fixture((_manifest, lock) => {
      lock.packages["node_modules/lodash"].integrity = "sha512-unexpected";
    });

    expect(validateDependencyMutation(patch, target, version).valid).toBe(
      false,
    );
  });

  it("rejects an unauthorized resolved URL change", () => {
    const patch = fixture((_manifest, lock) => {
      lock.packages["node_modules/lodash"].resolved =
        "https://unexpected.example/package.tgz";
    });

    expect(validateDependencyMutation(patch, target, version).valid).toBe(
      false,
    );
  });

  it("accepts equivalent JSON with reordered properties", () => {
    const patch = fixture();

    const manifest = patch.files.find((file) => file.path === "package.json");

    if (!manifest?.after) {
      throw new Error("Missing manifest fixture.");
    }

    const parsed = JSON.parse(manifest.after) as Record<string, unknown>;

    manifest.after = JSON.stringify(
      Object.fromEntries(Object.entries(parsed).reverse()),
    );

    expect(validateDependencyMutation(patch, target, version).valid).toBe(true);
  });
});

describe("real npm dependency upgrade compatibility", () => {
  it("accepts authorized target-package metadata changes", () => {
    const patch = fixture((_manifest, lock) => {
      lock.packages["node_modules/braces"] = {
        version: "3.0.3",
        resolved: "https://registry.npmjs.org/braces/-/braces-3.0.3.tgz",
        integrity:
          "sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==",
        license: "MIT",
        dependencies: {
          "fill-range": "^7.1.1",
        },
        engines: {
          node: ">=8",
        },
      };
    });

    const lockChange = patch.files.find(
      (file) => file.path === "package-lock.json",
    );

    if (!lockChange?.before) {
      throw new Error("Missing original lockfile fixture.");
    }

    const originalLock = JSON.parse(lockChange.before);
    originalLock.packages["node_modules/braces"].resolved =
      "https://registry.npmjs.org/braces/-/braces-3.0.2.tgz";

    lockChange.before = JSON.stringify(originalLock);

    expect(validateDependencyMutation(patch, target, version).valid).toBe(true);
  });
});

describe("authorized package metadata security", () => {
  it("rejects a target package redirected to an untrusted host", () => {
    const patch = fixture((_manifest, lock) => {
      lock.packages["node_modules/braces"].resolved =
        "https://attacker.example/braces-3.0.3.tgz";
    });

    expect(validateDependencyMutation(patch, target, version).valid).toBe(
      false,
    );
  });
});
