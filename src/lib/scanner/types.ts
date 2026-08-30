import type { RepositoryFact } from "@/lib/evidence/types";

export interface RepositoryScanResult {
  repositoryPath: string;
  scannedAt: string;
  facts: RepositoryFact[];
}