import fs from "node:fs";
import path from "node:path";

import type { RepositoryFact } from "@/lib/evidence/types";
import type { RepositoryScanResult } from "@/lib/scanner/types";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function fileExists(repositoryPath: string, file: string): boolean {
  return fs.existsSync(path.join(repositoryPath, file));
}

function readPackageJson(repositoryPath: string): PackageJson | null {
  const packageJsonPath = path.join(repositoryPath, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(packageJsonPath, "utf-8");
    return JSON.parse(content) as PackageJson;
  } catch {
    return null;
  }
}

function hasDependency(
  packageJson: PackageJson,
  dependency: string
): boolean {
  return Boolean(
    packageJson.dependencies?.[dependency] ||
    packageJson.devDependencies?.[dependency]
  );
}

function getDependencyVersion(
  packageJson: PackageJson,
  dependency: string
): string | null {
  return (
    packageJson.dependencies?.[dependency] ??
    packageJson.devDependencies?.[dependency] ??
    null
  );
}

function createFileFact(
  key: string,
  value: string,
  file: string,
  description: string
): RepositoryFact {
  return {
    key,
    value,
    confidence: 1,
    evidence: [
      {
        source: "file",
        path: file,
        description,
      },
    ],
  };
}

export function scanRepository(
  repositoryPath: string
): RepositoryScanResult {
  const facts: RepositoryFact[] = [];

  const packageJson = readPackageJson(repositoryPath);

  // Language
  if (fileExists(repositoryPath, "tsconfig.json")) {
    facts.push(
      createFileFact(
        "language",
        "TypeScript",
        "tsconfig.json",
        "TypeScript configuration file detected"
      )
    );
  }

  // Framework
  if (
    fileExists(repositoryPath, "next.config.ts") ||
    fileExists(repositoryPath, "next.config.js") ||
    fileExists(repositoryPath, "next.config.mjs")
  ) {
    const configFile = [
      "next.config.ts",
      "next.config.js",
      "next.config.mjs",
    ].find((file) => fileExists(repositoryPath, file));

    if (configFile) {
      facts.push(
        createFileFact(
          "framework",
          "Next.js",
          configFile,
          "Next.js configuration file detected"
        )
      );
    }
  }

  // Package manager
  if (fileExists(repositoryPath, "pnpm-lock.yaml")) {
    facts.push(
      createFileFact(
        "packageManager",
        "pnpm",
        "pnpm-lock.yaml",
        "pnpm lockfile detected"
      )
    );
  } else if (fileExists(repositoryPath, "yarn.lock")) {
    facts.push(
      createFileFact(
        "packageManager",
        "Yarn",
        "yarn.lock",
        "Yarn lockfile detected"
      )
    );
  } else if (fileExists(repositoryPath, "package-lock.json")) {
    facts.push(
      createFileFact(
        "packageManager",
        "npm",
        "package-lock.json",
        "npm lockfile detected"
      )
    );
  }

  // Prisma
  if (fileExists(repositoryPath, "prisma/schema.prisma")) {
    facts.push(
      createFileFact(
        "orm",
        "Prisma",
        "prisma/schema.prisma",
        "Prisma schema detected"
      )
    );
  }

  // Vitest
  if (
    fileExists(repositoryPath, "vitest.config.ts") ||
    fileExists(repositoryPath, "vitest.config.js")
  ) {
    const configFile = fileExists(
      repositoryPath,
      "vitest.config.ts"
    )
      ? "vitest.config.ts"
      : "vitest.config.js";

    facts.push(
      createFileFact(
        "testFramework",
        "Vitest",
        configFile,
        "Vitest configuration detected"
      )
    );
  }

  // Package-based detection
// Package-based detection
if (packageJson) {
  const nextVersion = getDependencyVersion(packageJson, "next");

  if (nextVersion) {
    facts.push({
      key: "frameworkVersion",
      value: nextVersion,
      confidence: 1,
      evidence: [
        {
          source: "package",
          path: "package.json",
          description: `Next.js dependency version ${nextVersion} detected`,
        },
      ],
    });
  }

  const typescriptVersion = getDependencyVersion(
    packageJson,
    "typescript"
  );

  if (typescriptVersion) {
    facts.push({
      key: "languageVersion",
      value: typescriptVersion,
      confidence: 1,
      evidence: [
        {
          source: "package",
          path: "package.json",
          description: `TypeScript dependency version ${typescriptVersion} detected`,
        },
      ],
    });
  }

  if (hasDependency(packageJson, "next-auth")) {
    facts.push({
      key: "authentication",
      value: "NextAuth",
      confidence: 1,
      evidence: [
        {
          source: "package",
          path: "package.json",
          description: "next-auth dependency detected",
        },
      ],
    });
  }

  if (
    hasDependency(packageJson, "prisma") ||
    hasDependency(packageJson, "@prisma/client")
  ) {
    facts.push({
      key: "orm",
      value: "Prisma",
      confidence: 1,
      evidence: [
        {
          source: "package",
          path: "package.json",
          description: "Prisma dependency detected",
        },
      ],
    });
  }

  if (hasDependency(packageJson, "vitest")) {
    facts.push({
      key: "testFramework",
      value: "Vitest",
      confidence: 1,
      evidence: [
        {
          source: "package",
          path: "package.json",
          description: "Vitest dependency detected",
        },
      ],
    });
  }

  if (hasDependency(packageJson, "jest")) {
    facts.push({
      key: "testFramework",
      value: "Jest",
      confidence: 1,
      evidence: [
        {
          source: "package",
          path: "package.json",
          description: "Jest dependency detected",
        },
      ],
    });
  }
}

  return {
    repositoryPath,
    scannedAt: new Date().toISOString(),
    facts,
  };
}