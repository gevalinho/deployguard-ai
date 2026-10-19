import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import type { RepositoryFact } from "@/lib/evidence/types";

type PackageScripts = Record<string, string> | undefined;

/** A narrow proof that this root package runs interpreted JavaScript directly. */
export function hasDirectNodeApiRuntime(
  repositoryPath: string,
  scripts: PackageScripts,
  facts: RepositoryFact[],
): boolean {
  if (!facts.some((fact) => fact.key === "framework" && fact.value === "Express")) return false;
  if (facts.some((fact) =>
    (fact.key === "framework" && ["Next.js", "React"].includes(fact.value)) ||
    (fact.key === "tooling" && fact.value === "Vite") ||
    (fact.key === "language" && fact.value === "TypeScript")
  )) return false;
  if (existsSync(resolve(repositoryPath, "tsconfig.json"))) return false;
  if (scripts?.prestart || scripts?.prepare || scripts?.postinstall) return false;

  const start = scripts?.start?.trim();
  const match = start && /^node\s+(?:\.\/)?([A-Za-z0-9_./-]+\.(?:js|mjs|cjs))$/.exec(start);
  if (!match) return false;

  const entry = resolve(repositoryPath, match[1]);
  const pathInRepository = relative(repositoryPath, entry);
  if (pathInRepository.startsWith("..") || isAbsolute(pathInRepository)) return false;
  if (/^(?:dist|build|out)\//.test(pathInRepository)) return false;

  return existsSync(entry) && statSync(entry).isFile();
}

/** Proof for a small npm dependency exercise with tests but no application entry. */
export function isDependencyOnlyNpmPackage(repositoryPath: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(repositoryPath, "package.json"), "utf8"));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
        manifest.private !== true || manifest.workspaces || manifest.main || manifest.module ||
        manifest.exports || manifest.bin || manifest.browser || manifest.types || manifest.typings ||
        !manifest.scripts || typeof manifest.scripts !== "object" || Array.isArray(manifest.scripts) ||
        Object.keys(manifest.scripts).length !== 1 || manifest.scripts.test !== "node --test" ||
        !manifest.dependencies || typeof manifest.dependencies !== "object" ||
        Array.isArray(manifest.dependencies) || !Object.keys(manifest.dependencies).length ||
        !existsSync(join(repositoryPath, "package-lock.json"))) return false;

    const tooling = { ...manifest.dependencies, ...manifest.devDependencies };
    const applicationTools = ["next", "react", "react-dom", "vite", "express", "typescript",
      "webpack", "rollup", "esbuild", "parcel", "astro", "nuxt", "vue", "svelte",
      "@angular/core", "@nestjs/core", "fastify", "koa", "hono", "babel", "@babel/core"];
    if (applicationTools.some((name) => Object.hasOwn(tooling, name))) return false;

    const allowedRootFiles = new Set(["package.json", "package-lock.json", ".gitignore",
      "README.md", "LICENSE", "LICENSE.md"]);
    let hasTestFile = false;
    for (const entry of readdirSync(repositoryPath, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) return false;
      if ([".git", "node_modules"].includes(entry.name) && entry.isDirectory()) continue;
      if (entry.name === "test" && entry.isDirectory()) {
        const tests = readdirSync(join(repositoryPath, "test"), { withFileTypes: true });
        if (!tests.length || tests.some((test) => !test.isFile() ||
            !/^[\w.-]+\.test\.(?:js|cjs|mjs)$/.test(test.name))) return false;
        hasTestFile = true;
      } else if (!entry.isFile() || !allowedRootFiles.has(entry.name)) return false;
    }
    return hasTestFile;
  } catch {
    return false;
  }
}
