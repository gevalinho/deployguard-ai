import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadinessDashboard } from "./readiness-dashboard";

describe("repository assessment sign-in state", () => {
  it("offers the existing GitHub sign-in flow without an initial auth error", () => {
    const html = renderToStaticMarkup(<ReadinessDashboard developer={null} />);

    expect(html).toContain('href="/api/auth/github/start"');
    expect(html).toContain("Sign in with GitHub to assess private repositories");
    expect(html).not.toContain("Developer sign-in required.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Assess Repository<\/button>/);
  });

  it("keeps the assessment action available to a signed-in developer", () => {
    const html = renderToStaticMarkup(
      <ReadinessDashboard developer={{ login: "octocat" }} />,
    );

    expect(html).not.toContain('href="/api/auth/github/start"');
    expect(html).toContain(">Assess Repository</button>");
  });
});
