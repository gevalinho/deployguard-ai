export interface GitHubRepository {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  cloneUrl: string;
}

export function parseGitHubRepositoryUrl(
  input: string
): GitHubRepository {
  const value = input.trim();

  if (!value) {
    throw new Error(
      "GitHub repository URL is required."
    );
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Enter a valid GitHub repository URL."
    );
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com"
  ) {
    throw new Error(
      "Only HTTPS GitHub repository URLs are supported."
    );
  }

  const segments = url.pathname
    .split("/")
    .filter(Boolean);

  if (segments.length !== 2) {
    throw new Error(
      "The URL must point directly to a GitHub repository."
    );
  }

  const owner = segments[0];

  const name = segments[1].replace(
    /\.git$/i,
    ""
  );

  if (!owner || !name) {
    throw new Error(
      "The GitHub repository owner or name is missing."
    );
  }

  const fullName = `${owner}/${name}`;
  const canonicalUrl =
    `https://github.com/${fullName}`;

  return {
    owner,
    name,
    fullName,
    url: canonicalUrl,
    cloneUrl: `${canonicalUrl}.git`,
  };
}