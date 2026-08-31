import fs from "node:fs";
import path from "node:path";

import type { RepositoryFact } from "@/lib/evidence/types";
import type { RepositoryScanResult } from "@/lib/scanner/types";

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function fileExists(repositoryPath: string, file: string): boolean {
  return fs.existsSync(path.join(repositoryPath, file));
}

function directoryExists(
  repositoryPath: string,
  directory: string
): boolean {
  const targetPath = path.join(repositoryPath, directory);

  return (
    fs.existsSync(targetPath) &&
    fs.statSync(targetPath).isDirectory()
  );
}

function readPackageJson(
  repositoryPath: string
): PackageJson | null {
  const packageJsonPath = path.join(
    repositoryPath,
    "package.json"
  );

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(
      packageJsonPath,
      "utf-8"
    );

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

function createFact(
  key: string,
  value: string,
  source: "file" | "package" | "config",
  evidencePath: string,
  description: string
): RepositoryFact {
  return {
    key,
    value,
    confidence: 1,
    evidence: [
      {
        source,
        path: evidencePath,
        description,
      },
    ],
  };
}

function addFactIfMissing(
  facts: RepositoryFact[],
  fact: RepositoryFact
): void {
  const exists = facts.some(
    (existingFact) =>
      existingFact.key === fact.key &&
      existingFact.value === fact.value
  );

  if (!exists) {
    facts.push(fact);
  }
}

function detectLanguage(
  repositoryPath: string,
  facts: RepositoryFact[]
): void {
  if (fileExists(repositoryPath, "tsconfig.json")) {
    facts.push(
      createFact(
        "language",
        "TypeScript",
        "file",
        "tsconfig.json",
        "TypeScript configuration file detected"
      )
    );
  }
}

function detectFramework(
  repositoryPath: string,
  facts: RepositoryFact[]
): void {
  const nextConfigFiles = [
    "next.config.ts",
    "next.config.js",
    "next.config.mjs",
  ];

  const configFile = nextConfigFiles.find((file) =>
    fileExists(repositoryPath, file)
  );

  if (!configFile) {
    return;
  }

  facts.push(
    createFact(
      "framework",
      "Next.js",
      "config",
      configFile,
      "Next.js configuration file detected"
    )
  );
}

function detectPackageManager(
  repositoryPath: string,
  facts: RepositoryFact[]
): void {
  if (fileExists(repositoryPath, "pnpm-lock.yaml")) {
    facts.push(
      createFact(
        "packageManager",
        "pnpm",
        "file",
        "pnpm-lock.yaml",
        "pnpm lockfile detected"
      )
    );

    return;
  }

  if (fileExists(repositoryPath, "yarn.lock")) {
    facts.push(
      createFact(
        "packageManager",
        "Yarn",
        "file",
        "yarn.lock",
        "Yarn lockfile detected"
      )
    );

    return;
  }

  if (fileExists(repositoryPath, "package-lock.json")) {
    facts.push(
      createFact(
        "packageManager",
        "npm",
        "file",
        "package-lock.json",
        "npm lockfile detected"
      )
    );
  }
}

function detectOrm(
  repositoryPath: string,
  packageJson: PackageJson | null,
  facts: RepositoryFact[]
): void {
  if (fileExists(repositoryPath, "prisma/schema.prisma")) {
    addFactIfMissing(
      facts,
      createFact(
        "orm",
        "Prisma",
        "config",
        "prisma/schema.prisma",
        "Prisma schema detected"
      )
    );
  }

  if (
    packageJson &&
    (hasDependency(packageJson, "prisma") ||
      hasDependency(packageJson, "@prisma/client"))
  ) {
    addFactIfMissing(
      facts,
      createFact(
        "orm",
        "Prisma",
        "package",
        "package.json",
        "Prisma dependency detected"
      )
    );
  }
}

function detectTestConfiguration(
  repositoryPath: string,
  packageJson: PackageJson | null,
  facts: RepositoryFact[]
): void {
  const vitestConfigFiles = [
    "vitest.config.ts",
    "vitest.config.js",
  ];

  const vitestConfig = vitestConfigFiles.find((file) =>
    fileExists(repositoryPath, file)
  );

  if (vitestConfig) {
    addFactIfMissing(
      facts,
      createFact(
        "testFramework",
        "Vitest",
        "config",
        vitestConfig,
        "Vitest configuration detected"
      )
    );
  }

  if (!packageJson) {
    return;
  }

  if (hasDependency(packageJson, "vitest")) {
    addFactIfMissing(
      facts,
      createFact(
        "testFramework",
        "Vitest",
        "package",
        "package.json",
        "Vitest dependency detected"
      )
    );
  }

  if (hasDependency(packageJson, "jest")) {
    addFactIfMissing(
      facts,
      createFact(
        "testFramework",
        "Jest",
        "package",
        "package.json",
        "Jest dependency detected"
      )
    );
  }

  const testScript = packageJson.scripts?.test;

  if (testScript) {
    facts.push(
      createFact(
        "testScript",
        testScript,
        "package",
        "package.json",
        `Test script detected: ${testScript}`
      )
    );
  }
}

function detectPackageFacts(
  packageJson: PackageJson | null,
  facts: RepositoryFact[]
): void {
  if (!packageJson) {
    return;
  }

  const nextVersion = getDependencyVersion(
    packageJson,
    "next"
  );

  if (nextVersion) {
    facts.push(
      createFact(
        "frameworkVersion",
        nextVersion,
        "package",
        "package.json",
        `Next.js dependency version ${nextVersion} detected`
      )
    );
  }

  const typescriptVersion = getDependencyVersion(
    packageJson,
    "typescript"
  );

  if (typescriptVersion) {
    facts.push(
      createFact(
        "languageVersion",
        typescriptVersion,
        "package",
        "package.json",
        `TypeScript dependency version ${typescriptVersion} detected`
      )
    );
  }

  if (hasDependency(packageJson, "next-auth")) {
    facts.push(
      createFact(
        "authentication",
        "NextAuth",
        "package",
        "package.json",
        "next-auth dependency detected"
      )
    );
  }
}

function detectDeployment(
  repositoryPath: string,
  facts: RepositoryFact[]
): void {
  if (fileExists(repositoryPath, "Dockerfile")) {
    facts.push(
      createFact(
        "deployment",
        "docker",
        "config",
        "Dockerfile",
        "Dockerfile detected in repository root"
      )
    );
  }

  if (fileExists(repositoryPath, "vercel.json")) {
    facts.push(
      createFact(
        "deployment",
        "vercel",
        "config",
        "vercel.json",
        "Vercel configuration file detected"
      )
    );
  }

  const workflowsDirectory = ".github/workflows";

  if (!directoryExists(repositoryPath, workflowsDirectory)) {
    return;
  }

  const workflowPath = path.join(
    repositoryPath,
    workflowsDirectory
  );

  const workflowFiles = fs
    .readdirSync(workflowPath)
    .filter(
      (file) =>
        file.endsWith(".yml") ||
        file.endsWith(".yaml")
    );

  if (workflowFiles.length === 0) {
    return;
  }

  facts.push({
    key: "ci",
    value: "github-actions",
    confidence: 1,
    evidence: workflowFiles.map((file) => ({
      source: "config" as const,
      path: `${workflowsDirectory}/${file}`,
      description: `GitHub Actions workflow detected: ${file}`,
    })),
  });
}

export function scanRepository(
  repositoryPath: string
): RepositoryScanResult {
  const facts: RepositoryFact[] = [];
  const packageJson = readPackageJson(repositoryPath);

  detectLanguage(repositoryPath, facts);
  detectFramework(repositoryPath, facts);
  detectPackageManager(repositoryPath, facts);

  detectPackageFacts(packageJson, facts);

  detectOrm(repositoryPath, packageJson, facts);

  detectTestConfiguration(
    repositoryPath,
    packageJson,
    facts
  );

  detectDeployment(repositoryPath, facts);

  return {
    repositoryPath,
    scannedAt: new Date().toISOString(),
    facts,
  };
}