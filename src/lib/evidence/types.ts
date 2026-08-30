export type EvidenceSource = "file" | "package" | "config";

export interface Evidence {
  source: EvidenceSource;
  path: string;
  description: string;
}

export interface RepositoryFact {
  key: string;
  value: string;
  confidence: number;
  evidence: Evidence[];
}