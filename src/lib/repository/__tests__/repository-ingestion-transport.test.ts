import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  GitHubRepository,
} from "@/lib/repository/github-repository";

import type {
  RepositoryReadTransportFactory,
} from "@/lib/repository/github-read-transport";

import {
  ingestGitHubRepository,
} from "@/lib/repository/repository-ingestion";

describe(
  "repository ingestion read transport lifecycle",
  () => {
    it(
      "disposes repository-read authority when ingestion fails",
      async () => {
        const dispose =
          vi.fn(async () => {});

        const readTransportFactory:
          RepositoryReadTransportFactory =
          vi.fn(
            async () => ({
              env: {
                GIT_TERMINAL_PROMPT:
                  "0",
              },

              dispose,
            })
          );

        /*
         * Use a repository identity that cannot resolve
         * to a real GitHub repository.
         *
         * This exercises the real ingestion failure path
         * without requiring a live private repository or
         * real credentials.
         */
        const repository:
          GitHubRepository = {
            owner:
              "deployguard-ingestion-test",
            name:
              "repository-that-does-not-exist",
            fullName:
              "deployguard-ingestion-test/repository-that-does-not-exist",
            url:
              "https://github.com/deployguard-ingestion-test/repository-that-does-not-exist",
            cloneUrl:
              "https://github.com/deployguard-ingestion-test/repository-that-does-not-exist.git",
          };

        await expect(
          ingestGitHubRepository(
            repository,
            undefined,
            readTransportFactory
          )
        ).rejects.toThrow();

        expect(
          readTransportFactory
        ).toHaveBeenCalledTimes(1);

        expect(
          readTransportFactory
        ).toHaveBeenCalledWith(
          repository
        );

        /*
         * Security invariant:
         *
         * Repository credentials must be destroyed even
         * when repository acquisition fails.
         */
        expect(
          dispose
        ).toHaveBeenCalledTimes(1);
      },
      30_000
    );
  }
);
