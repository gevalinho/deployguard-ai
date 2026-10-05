import {
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInstallationAccessToken } from "@/lib/remediation/github-app-auth";
import { githubRemoteMatches } from "@/lib/remediation/github-app-git-transport";
import type {
  RepositoryReadTransportFactory,
} from "@/lib/repository/github-read-transport";

type InstallationTokenIssuer =
  typeof createInstallationAccessToken;

/*
 * Creates an ephemeral, read-only authentication
 * environment for GitHub repository ingestion.
 *
 * Credentials exist only in process-local Git
 * configuration and are never written into the
 * repository workspace.
 */
export function createGitHubAppReadTransport(
  issueToken: InstallationTokenIssuer =
    createInstallationAccessToken,
): RepositoryReadTransportFactory {
  return async (repository) => {
    const repositoryIdentity =
      repository.fullName;

    const remote =
      `https://github.com/${repositoryIdentity}.git`;

    if (
      !githubRemoteMatches(
        repositoryIdentity,
        remote,
      )
    ) {
      throw new Error(
        "GitHub read repository identity mismatch.",
      );
    }

    const [owner, repositoryName] =
      repositoryIdentity.split("/");

    const access = await issueToken(
      owner,
      repositoryName,
      {
        contents: "read",
        pull_requests: "read",
      },
    );

    const expiresAt =
      Date.parse(access.expiresAt);

    if (
      access.repositoryIdentity !==
        repositoryIdentity ||
      !access.token ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      throw new Error(
        "Invalid installation token scope or expiry.",
      );
    }

    const directory = await mkdtemp(
      join(
        tmpdir(),
        "deployguard-read-",
      ),
    );

    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      NODE_ENV: process.env.NODE_ENV,

      HOME: directory,
      XDG_CONFIG_HOME: directory,

      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ALLOW_PROTOCOL: "https",
      LC_ALL: "C",
    };

    const config = [
      [
        "credential.helper",
        "",
      ],
      [
        "http.followRedirects",
        "false",
      ],
      [
        "http.sslVerify",
        "true",
      ],
      [
        `http.${remote}.extraheader`,
        `Authorization: Basic ${Buffer.from(
          `x-access-token:${access.token}`,
        ).toString("base64")}`,
      ],
    ];

    env.GIT_CONFIG_PARAMETERS =
      config
        .map(([key, value]) => {
          const pair =
            `${key}=${value}`;

          if (pair.includes("'")) {
            throw new Error(
              "Invalid ephemeral Git configuration.",
            );
          }

          return `'${pair}'`;
        })
        .join(" ");

    let disposed = false;

    return {
      env,

      async dispose() {
        if (disposed) {
          return;
        }

        disposed = true;

        for (
          const key of Object.keys(env)
        ) {
          delete env[key];
        }

        await rm(directory, {
          recursive: true,
          force: true,
        });
      },
    };
  };
}

export const openGitHubAppReadTransport =
  createGitHubAppReadTransport();
