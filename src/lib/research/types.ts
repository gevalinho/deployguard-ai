export type ResearchSourceType =
  | "official_documentation"
  | "security_advisory"
  | "release_notes"
  | "vendor_guidance"
  | "community"
  | "other";

export type ResearchSourceAuthority =
  | "primary"
  | "secondary"
  | "community";

export interface ResearchSource {
  title: string;
  url: string;
  sourceType: ResearchSourceType;
  authority: ResearchSourceAuthority;
  publisher?: string;
  publishedAt?: string;
}

export interface ResearchEvidence {
  topic: string;
  excerpt: string;
  relevanceScore?: number;
  source: ResearchSource;
}

export interface ResearchResult {
  query: string;
  researchedAt: string;
  evidence: ResearchEvidence[];
}