import { beforeEach, describe, expect, it, vi } from "vitest";

const { session, authorize, remediate, transport } = vi.hoisted(() => ({
  session: vi.fn(), authorize: vi.fn(), remediate: vi.fn(), transport: vi.fn(),
}));
vi.mock("@/lib/auth/developer-session", () => ({ readDeveloperSession: session, sameOrigin: () => true }));
vi.mock("@/lib/auth/github-developer-auth", () => ({ authorizeDeveloperRepository: authorize }));
vi.mock("@/lib/orchestration/remediation-orchestrator", () => ({ runRemoteRemediation: remediate }));
vi.mock("@/lib/repository/github-app-read-transport", () => ({ openGitHubAppReadTransport: transport }));

import { POST } from "./route";

const proposal = { id: "fix", title: "Fix", description: "Fix lint", strategy: "lint_autofix", risk: "safe",
  target: { checkId: "lint", category: "lint", evidenceIndexes: [] } };
const request = () => new Request("https://deployguard.test/api/remediation", { method: "POST",
  body: JSON.stringify({ repositoryUrl: "https://github.com/owner/repo", proposal }) });

describe("remediation repository authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.mockReturnValue({ githubId: "1", login: "developer" });
    authorize.mockResolvedValue(true);
    remediate.mockResolvedValue({ remediation: { proof: { status: "proven" } } });
  });

  it("passes the scoped read transport only after developer authorization", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(authorize).toHaveBeenCalledWith({ githubId: "1", login: "developer" }, "owner/repo");
    expect(remediate).toHaveBeenCalledWith("https://github.com/owner/repo", proposal, transport);
  });

  it("does not ingest without a developer session or repository authorization", async () => {
    session.mockReturnValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    authorize.mockResolvedValueOnce(false);
    expect((await POST(request())).status).toBe(403);
    expect(remediate).not.toHaveBeenCalled();
  });
});
