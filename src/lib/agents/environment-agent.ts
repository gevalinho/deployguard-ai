import fs from "node:fs";
import path from "node:path";

import type { CheckResult } from "@/lib/checks/types";
import type { RepositoryScanResult } from "@/lib/scanner/types";

function extractVariableNames(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        line.includes("=")
    )
    .map((line) => line.split("=")[0].trim())
    .filter(Boolean);
}

function readEnvironmentVariableNames(
  filePath: string
): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");

  return extractVariableNames(content);
}

function looksSensitive(variableName: string): boolean {
  const sensitivePatterns = [
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PRIVATE",
    "API_KEY",
    "DATABASE_URL",
  ];

  return sensitivePatterns.some((pattern) =>
    variableName.toUpperCase().includes(pattern)
  );
}

export async function runEnvironmentAgent(
  scan: RepositoryScanResult
): Promise<CheckResult> {
  const envPath = path.join(scan.repositoryPath, ".env");
  const examplePath = path.join(
    scan.repositoryPath,
    ".env.example"
  );

  const envExists = fs.existsSync(envPath);
  const exampleExists = fs.existsSync(examplePath);

  const envVariables = readEnvironmentVariableNames(envPath);
  const exampleVariables =
    readEnvironmentVariableNames(examplePath);

  const undocumentedVariables = envVariables.filter(
    (variable) => !exampleVariables.includes(variable)
  );

  const exposedSensitiveVariables = envVariables.filter(
    (variable) =>
      variable.startsWith("NEXT_PUBLIC_") &&
      looksSensitive(variable)
  );

  if (exposedSensitiveVariables.length > 0) {
    return {
      id: "environment-config",
      category: "environment",
      name: "Environment Configuration",
      status: "failed",
      summary:
        `Potentially sensitive public environment variables detected: ${exposedSensitiveVariables.join(", ")}.`,
    };
  }

  if (!envExists) {
    return {
      id: "environment-config",
      category: "environment",
      name: "Environment Configuration",
      status: "skipped",
      summary:
        "No .env file was detected for environment validation.",
    };
  }

  if (!exampleExists) {
    return {
      id: "environment-config",
      category: "environment",
      name: "Environment Configuration",
      status: "failed",
      summary:
        "Environment variables are configured, but .env.example is missing.",
    };
  }

  if (undocumentedVariables.length > 0) {
    return {
      id: "environment-config",
      category: "environment",
      name: "Environment Configuration",
      status: "failed",
      summary:
        `Environment variables are not documented in .env.example: ${undocumentedVariables.join(", ")}.`,
    };
  }

  return {
    id: "environment-config",
    category: "environment",
    name: "Environment Configuration",
    status: "passed",
    summary:
      "Environment configuration is documented and no obviously sensitive public variable names were detected.",
  };
}