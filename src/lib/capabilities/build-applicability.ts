import { existsSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
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
