import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";

import {
  join,
} from "node:path";

import {
  tmpdir,
} from "node:os";

import {
  detectPackageManager,
} from "@/lib/sandbox/package-manager";

interface TestCase {
  name: string;

  packageJson?: Record<
    string,
    unknown
  >;

  files: string[];

  expected: {
    name:
      | "npm"
      | "pnpm"
      | "yarn";

    majorVersion?: number;

    yarnMode?:
      | "classic"
      | "modern";

    source:
      | "lockfile"
      | "lockfile_and_package_json"
      | "lockfile_and_repository_config";
  };
}

const testCases: TestCase[] = [
  {
    name:
      "npm lockfile only",

    packageJson: {
      name:
        "npm-test",
    },

    files: [
      "package-lock.json",
    ],

    expected: {
      name:
        "npm",

      source:
        "lockfile",
    },
  },

  {
    name:
      "pnpm with packageManager declaration",

    packageJson: {
      name:
        "pnpm-test",

      packageManager:
        "pnpm@10.19.0",
    },

    files: [
      "pnpm-lock.yaml",
    ],

    expected: {
      name:
        "pnpm",

      majorVersion:
        10,

      source:
        "lockfile_and_package_json",
    },
  },

  {
    name:
      "Yarn Classic lockfile only",

    packageJson: {
      name:
        "yarn-classic-test",
    },

    files: [
      "yarn.lock",
    ],

    expected: {
      name:
        "yarn",

      majorVersion:
        1,

      yarnMode:
        "classic",

      source:
        "lockfile",
    },
  },

  {
    name:
      "Yarn Classic declared",

    packageJson: {
      name:
        "yarn-classic-declared",

      packageManager:
        "yarn@1.22.22",
    },

    files: [
      "yarn.lock",
    ],

    expected: {
      name:
        "yarn",

      majorVersion:
        1,

      yarnMode:
        "classic",

      source:
        "lockfile_and_package_json",
    },
  },

  {
    name:
      "Yarn 4 declared",

    packageJson: {
      name:
        "yarn-modern-declared",

      packageManager:
        "yarn@4.9.2",
    },

    files: [
      "yarn.lock",
    ],

    expected: {
      name:
        "yarn",

      majorVersion:
        4,

      yarnMode:
        "modern",

      source:
        "lockfile_and_package_json",
    },
  },

  {
    name:
      "Modern Yarn detected from repository config",

    packageJson: {
      name:
        "yarn-modern-config",
    },

    files: [
      "yarn.lock",
      ".yarnrc.yml",
    ],

    expected: {
      name:
        "yarn",

      yarnMode:
        "modern",

      source:
        "lockfile_and_repository_config",
    },
  },
];

let passed = 0;

for (
  const testCase
  of testCases
) {
  const repositoryPath =
    mkdtempSync(
      join(
        tmpdir(),
        "deployguard-package-manager-"
      )
    );

  try {
    writeFileSync(
      join(
        repositoryPath,
        "package.json"
      ),
      JSON.stringify(
        testCase.packageJson ?? {},
        null,
        2
      )
    );

    for (
      const file
      of testCase.files
    ) {
      const filePath =
        join(
          repositoryPath,
          file
        );

      const parentDirectory =
        filePath.slice(
          0,
          filePath.lastIndexOf("/")
        );

      if (parentDirectory) {
        mkdirSync(
          parentDirectory,
          {
            recursive: true,
          }
        );
      }

      writeFileSync(
        filePath,
        ""
      );
    }

    const detected =
      detectPackageManager(
        repositoryPath
      );

    if (!detected) {
      throw new Error(
        `${testCase.name}: no package manager detected`
      );
    }

    if (
      detected.name !==
      testCase.expected.name
    ) {
      throw new Error(
        `${testCase.name}: expected ${testCase.expected.name}, got ${detected.name}`
      );
    }

    if (
      testCase.expected.majorVersion !==
        undefined &&
      detected.majorVersion !==
        testCase.expected.majorVersion
    ) {
      throw new Error(
        `${testCase.name}: expected major version ${testCase.expected.majorVersion}, got ${detected.majorVersion}`
      );
    }

    if (
      testCase.expected.yarnMode !==
        undefined &&
      detected.yarnMode !==
        testCase.expected.yarnMode
    ) {
      throw new Error(
        `${testCase.name}: expected Yarn mode ${testCase.expected.yarnMode}, got ${detected.yarnMode}`
      );
    }

    if (
      detected.source !==
      testCase.expected.source
    ) {
      throw new Error(
        `${testCase.name}: expected source ${testCase.expected.source}, got ${detected.source}`
      );
    }

    console.log(
      `✓ ${testCase.name}`
    );

    console.log(
      detected
    );

    passed += 1;
  } finally {
    rmSync(
      repositoryPath,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

console.log(
  `\n${passed}/${testCases.length} package-manager detection tests passed.`
);