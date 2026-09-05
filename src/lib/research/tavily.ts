import type {
  ResearchEvidence,
  ResearchResult,
  ResearchSource,
  ResearchSourceAuthority,
  ResearchSourceType,
} from "@/lib/research/types";

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

interface TavilySearchResponse {
  query?: string;
  results?: TavilySearchResult[];
}

const PRIMARY_DOMAINS = new Set([
  "nextjs.org",
  "react.dev",
  "nodejs.org",
  "typescriptlang.org",
  "docs.github.com",
  "github.com",
  "npmjs.com",
  "docs.npmjs.com",
  "vercel.com",
]);

function getTavilyApiKey(): string {
  const apiKey =
    process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error(
      "TAVILY_API_KEY is missing."
    );
  }

  return apiKey;
}

function getHostname(
  url: string
): string | undefined {
  try {
    return new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function isPrimaryDomain(
  hostname?: string
): boolean {
  if (!hostname) {
    return false;
  }

  return (
    PRIMARY_DOMAINS.has(hostname) ||
    [...PRIMARY_DOMAINS].some(
      (domain) =>
        hostname.endsWith(
          `.${domain}`
        )
    )
  );
}

function classifyAuthority(
  url: string
): ResearchSourceAuthority {
  const hostname =
    getHostname(url);

  if (
    isPrimaryDomain(hostname)
  ) {
    return "primary";
  }

  if (
    hostname === "medium.com" ||
    hostname?.endsWith(
      ".medium.com"
    )
  ) {
    return "community";
  }

  return "secondary";
}

function classifySource(
  url: string
): ResearchSourceType {
  const normalized =
    url.toLowerCase();

  const hostname =
    getHostname(url);

  if (
    normalized.includes(
      "github.com/advisories"
    ) ||
    normalized.includes(
      "nvd.nist.gov"
    ) ||
    normalized.includes(
      "cve.org"
    )
  ) {
    return "security_advisory";
  }

  if (
    normalized.includes(
      "/releases/"
    ) ||
    normalized.includes(
      "/release"
    ) ||
    normalized.includes(
      "/changelog"
    ) ||
    normalized.includes(
      "/blog/next-"
    )
  ) {
    return "release_notes";
  }

  if (
    isPrimaryDomain(hostname)
  ) {
    return "official_documentation";
  }

  if (
    hostname === "medium.com" ||
    hostname?.endsWith(
      ".medium.com"
    )
  ) {
    return "community";
  }

  return "other";
}

function toResearchSource(
  result: TavilySearchResult
): ResearchSource | null {
  if (
    !result.url ||
    !result.title
  ) {
    return null;
  }

  return {
    title: result.title,
    url: result.url,
    sourceType:
      classifySource(result.url),
    authority:
      classifyAuthority(result.url),
    publisher:
      getHostname(result.url),
    publishedAt:
      result.published_date,
  };
}

function toResearchEvidence(
  result: TavilySearchResult
): ResearchEvidence | null {
  if (
    !result.content ||
    !result.url ||
    !result.title
  ) {
    return null;
  }

  const source =
    toResearchSource(result);

  if (!source) {
    return null;
  }

  return {
    topic: result.title,
    excerpt: result.content,
    relevanceScore:
      typeof result.score ===
      "number"
        ? result.score
        : undefined,
    source,
  };
}

export async function researchTopic(
  query: string
): Promise<ResearchResult> {
  const apiKey =
    getTavilyApiKey();

  const response =
    await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth:
            "advanced",
          max_results: 5,
          include_answer:
            false,
          include_raw_content:
            false,
        }),
      }
    );

  if (!response.ok) {
    throw new Error(
      `Tavily research request failed with status ${response.status}.`
    );
  }

  const data =
    (await response.json()) as TavilySearchResponse;

  const evidence =
    (data.results ?? [])
      .map(toResearchEvidence)
      .filter(
        (
          item
        ): item is ResearchEvidence =>
          item !== null
      );

  return {
    query:
      data.query ?? query,
    researchedAt:
      new Date().toISOString(),
    evidence,
  };
}