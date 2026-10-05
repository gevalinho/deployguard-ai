import type {
  GitHubRepository,
} from "@/lib/repository/github-repository";

export interface RepositoryReadTransport {
  /*
   * Environment supplied only to the Git process used
   * for remote repository access.
   *
   * These values must never be forwarded into the
   * repository workspace, sandbox, assessment report,
   * evidence, progress events, or logs.
   */
  env: Readonly<
    Partial<NodeJS.ProcessEnv>
  >;

  dispose?: () =>
    void | Promise<void>;
}

export type RepositoryReadTransportFactory =
  (
    repository: GitHubRepository
  ) =>
    Promise<RepositoryReadTransport>;
