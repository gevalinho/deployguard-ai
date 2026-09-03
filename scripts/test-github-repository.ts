import {
  parseGitHubRepositoryUrl,
} from "../src/lib/repository/github-repository";

function test(input: string) {
  console.log(`\nInput: ${input}`);

  try {
    const repository =
      parseGitHubRepositoryUrl(input);

    console.log(
      JSON.stringify(
        repository,
        null,
        2
      )
    );
  } catch (error) {
    console.log(
      "Rejected:",
      error instanceof Error
        ? error.message
        : error
    );
  }
}

test(
  "https://github.com/gevalinho/deployguard-ai"
);

test(
  "https://github.com/gevalinho/deployguard-ai.git"
);

test(
  "https://github.com/gevalinho/deployguard-ai/blob/main/package.json"
);

test(
  "https://example.com/test/project"
);