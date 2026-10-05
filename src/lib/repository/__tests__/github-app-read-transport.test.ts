import {
  access,
} from "node:fs/promises";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createGitHubAppReadTransport,
} from "@/lib/repository/github-app-read-transport";

import type {
  GitHubRepository,
} from "@/lib/repository/github-repository";

const repository:
  GitHubRepository = {
    owner: "gevalinho",
    name: "deployguard-ai",
    fullName:
      "gevalinho/deployguard-ai",
    url:
      "https://github.com/gevalinho/deployguard-ai",
    cloneUrl:
      "https://github.com/gevalinho/deployguard-ai.git",
  };

describe(
  "GitHub App repository read transport",
  () => {
    it(
      "creates repository-scoped ephemeral Git credentials and destroys them on disposal",
      async () => {
        const secret =
          "installation-token-secret";

        const issueToken = vi.fn(
          async () => ({
            token: secret,
            installationId: 123456,
            expiresAt:
              new Date(
                Date.now() +
                  60_000
              ).toISOString(),
            repositoryIdentity:
              repository.fullName,
          })
        );

        const factory =
          createGitHubAppReadTransport(
            issueToken
          );

        const transport =
          await factory(repository);

        expect(
          issueToken
        ).toHaveBeenCalledWith(
          "gevalinho",
          "deployguard-ai",
          {
            contents: "read",
            pull_requests: "read",
          }
        );

        expect(
          transport.env.HOME
        ).toBeTruthy();

        expect(
          transport.env.GIT_CONFIG_NOSYSTEM
        ).toBe("1");

        expect(
          transport.env.GIT_CONFIG_GLOBAL
        ).toBe("/dev/null");

        expect(
          transport.env.GIT_TERMINAL_PROMPT
        ).toBe("0");

        expect(
          transport.env.GIT_ALLOW_PROTOCOL
        ).toBe("https");

        const configuration =
          transport.env
            .GIT_CONFIG_PARAMETERS;

        expect(
          configuration
        ).toContain(
          "Authorization: Basic"
        );

        /*
         * The raw installation token must not appear
         * directly in the Git environment.
         */
        expect(
          JSON.stringify(
            transport.env
          )
        ).not.toContain(secret);

        const temporaryHome =
          transport.env.HOME;

        expect(
          temporaryHome
        ).toBeTruthy();

        await access(
          temporaryHome as string
        );

        await transport.dispose?.();

        expect(
          Object.keys(
            transport.env
          )
        ).toHaveLength(0);

        await expect(
          access(
            temporaryHome as string
          )
        ).rejects.toThrow();

        /*
         * Disposal must be idempotent.
         */
        await expect(
          transport.dispose?.()
        ).resolves.toBeUndefined();
      }
    );

    it(
      "rejects an installation token scoped to a different repository",
      async () => {
        const issueToken = vi.fn(
          async () => ({
            token:
              "wrong-repository-token",
            installationId: 123456,
            expiresAt:
              new Date(
                Date.now() +
                  60_000
              ).toISOString(),
            repositoryIdentity:
              "gevalinho/another-repository",
          })
        );

        const factory =
          createGitHubAppReadTransport(
            issueToken
          );

        await expect(
          factory(repository)
        ).rejects.toThrow(
          "Invalid installation token scope or expiry."
        );
      }
    );

    it(
      "rejects an expired installation token",
      async () => {
        const issueToken = vi.fn(
          async () => ({
            token:
              "expired-token",
            installationId: 123456,
            expiresAt:
              new Date(
                Date.now() -
                  60_000
              ).toISOString(),
            repositoryIdentity:
              repository.fullName,
          })
        );

        const factory =
          createGitHubAppReadTransport(
            issueToken
          );

        await expect(
          factory(repository)
        ).rejects.toThrow(
          "Invalid installation token scope or expiry."
        );
      }
    );
  }
);
