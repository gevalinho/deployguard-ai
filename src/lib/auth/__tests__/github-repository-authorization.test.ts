import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeDeveloperRepository } from "../github-developer-auth";
import {
  getRepositoryInstallation,
  GitHubRepositoryInstallationNotFoundError,
} from "@/lib/remediation/github-app-auth";

const developer = { githubId: "123", login: "developer" };
const repository = "owner/repository";
const access = {
  token: "test-token",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  installationId: 1,
  repositoryIdentity: repository,
};

afterEach(() => vi.unstubAllGlobals());

describe("repository installation lookup", () => {
  it("classifies only an installation lookup 404 as missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(getRepositoryInstallation("owner", "repository", "jwt"))
      .rejects.toBeInstanceOf(GitHubRepositoryInstallationNotFoundError);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repository/installation",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer jwt" }) }),
    );
  });

  it.each([401, 403, 500])("propagates HTTP %i as a lookup failure", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));

    await expect(getRepositoryInstallation("owner", "repository", "jwt"))
      .rejects.toThrow(`GitHub repository installation lookup failed with status ${status}.`);
  });

  it("propagates network and malformed response failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failed")));
    await expect(getRepositoryInstallation("owner", "repository", "jwt"))
      .rejects.toThrow("network failed");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: "invalid" })));
    await expect(getRepositoryInstallation("owner", "repository", "jwt"))
      .rejects.toThrow("valid installation ID");
  });
});

describe("developer repository authorization", () => {
  it("returns false for a missing repository installation", async () => {
    const issueToken = vi.fn().mockRejectedValue(new GitHubRepositoryInstallationNotFoundError());
    const permissionRequest = vi.fn();

    expect(await authorizeDeveloperRepository(developer, repository, issueToken, permissionRequest)).toBe(false);
    expect(permissionRequest).not.toHaveBeenCalled();
  });

  it.each(["lookup status 500", "invalid App configuration"])(
    "propagates %s",
    async (message) => {
      const issueToken = vi.fn().mockRejectedValue(new Error(message));
      await expect(authorizeDeveloperRepository(developer, repository, issueToken))
        .rejects.toThrow(message);
    },
  );

  it("requires the signed-in developer's identity and write permission", async () => {
    const issueToken = vi.fn().mockResolvedValue(access);
    const permissionRequest = vi.fn().mockImplementation(async () =>
      Response.json({ permission: "write", user: { id: 123 } }),
    );

    expect(await authorizeDeveloperRepository(developer, repository, issueToken, permissionRequest)).toBe(true);
    expect(issueToken).toHaveBeenCalledWith("owner", "repository", { pull_requests: "read" });
    expect(permissionRequest).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repository/collaborators/developer/permission",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }),
    );

    expect(await authorizeDeveloperRepository({ githubId: "999", login: "developer" }, repository, issueToken, permissionRequest)).toBe(false);
    permissionRequest.mockResolvedValue(Response.json({ permission: "read", user: { id: 123 } }));
    expect(await authorizeDeveloperRepository(developer, repository, issueToken, permissionRequest)).toBe(false);
  });
});
