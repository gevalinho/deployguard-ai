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

function detectInfrastructure(
  repositoryPath: string,
  packageJson: PackageJson | null,
  facts: RepositoryFact[]
): void {
  /*
   * Infrastructure discovery is evidence-driven.
   *
   * Detecting a dependency proves that the repository
   * contains an integration for that technology. It does
   * not prove that an external service is reachable or
   * correctly configured.
   */

  const prismaSchemaRelativePath =
    "prisma/schema.prisma";

  const prismaSchemaPath =
    path.join(
      repositoryPath,
      prismaSchemaRelativePath
    );

  if (fileExists(repositoryPath, prismaSchemaRelativePath)) {
    addFactIfMissing(
      facts,
      createFact(
        "orm",
        "Prisma",
        "config",
        prismaSchemaRelativePath,
        "Prisma schema detected"
      )
    );

    /*
     * Prisma declares its actual datasource provider in
     * schema.prisma. This is stronger evidence than merely
     * inferring a database from installed driver packages.
     */
    try {
      const prismaSchema =
        fs.readFileSync(
          prismaSchemaPath,
          "utf-8"
        );

      const datasourceMatch =
        prismaSchema.match(
          /datasource\s+\w+\s*\{[\s\S]*?provider\s*=\s*["']([^"']+)["'][\s\S]*?\}/
        );

      const provider =
        datasourceMatch?.[1]
          ?.trim()
          .toLowerCase();

      const prismaProviders:
        Record<string, string> = {
          postgresql: "PostgreSQL",
          mysql: "MySQL",
          sqlite: "SQLite",
          sqlserver: "SQL Server",
          mongodb: "MongoDB",
          cockroachdb: "CockroachDB",
        };

      const database =
        provider
          ? prismaProviders[provider]
          : undefined;

      if (database) {
        addFactIfMissing(
          facts,
          createFact(
            "database",
            database,
            "config",
            prismaSchemaRelativePath,
            `Prisma datasource provider detected: ${provider}`
          )
        );
      }
    } catch {
      /*
       * Infrastructure discovery must remain resilient.
       * An unreadable Prisma schema should not prevent
       * the rest of the repository from being scanned.
       */
    }
  }

  if (!packageJson) {
    return;
  }

  const packageDetections = [
    {
      dependencies: ["prisma", "@prisma/client"],
      key: "orm",
      value: "Prisma",
    },
    {
      dependencies: ["drizzle-orm"],
      key: "orm",
      value: "Drizzle",
    },
    {
      dependencies: ["sequelize"],
      key: "orm",
      value: "Sequelize",
    },
    {
      dependencies: ["typeorm"],
      key: "orm",
      value: "TypeORM",
    },
    {
      dependencies: ["mongoose"],
      key: "orm",
      value: "Mongoose",
    },
    {
      dependencies: ["mongodb"],
      key: "databaseDriver",
      value: "MongoDB",
    },
    {
      dependencies: ["pg"],
      key: "databaseDriver",
      value: "PostgreSQL",
    },
    {
      dependencies: ["mysql2"],
      key: "databaseDriver",
      value: "MySQL",
    },
    {
      dependencies: ["better-sqlite3", "sqlite3"],
      key: "databaseDriver",
      value: "SQLite",
    },
    {
      dependencies: ["@supabase/supabase-js"],
      key: "backendService",
      value: "Supabase",
    },
    {
      dependencies: ["firebase", "firebase-admin"],
      key: "backendService",
      value: "Firebase",
    },
    {
      dependencies: ["redis", "ioredis"],
      key: "cache",
      value: "Redis",
    },
  ];

  for (const detection of packageDetections) {
    const detectedDependencies =
      detection.dependencies.filter((dependency) =>
        hasDependency(packageJson, dependency)
      );

    if (detectedDependencies.length === 0) {
      continue;
    }

    addFactIfMissing(
      facts,
      createFact(
        detection.key,
        detection.value,
        "package",
        "package.json",
        `${detection.value} dependency detected: ${detectedDependencies.join(
          ", "
        )}`
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

  detectInfrastructure(repositoryPath, packageJson, facts);

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