import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadinessBreakdown } from "./readiness-breakdown";
import type { ReadinessCategoryBreakdown } from "@/lib/scoring/readiness-score";

describe("readiness breakdown status presentation", () => {
  it("distinguishes verified failures from verification limits and missing configuration", () => {
    const breakdown: ReadinessCategoryBreakdown[] = [
      { category: "test", weight: 20, earnedWeight: 0, evaluated: true, status: "failed" },
      { category: "build", weight: 30, earnedWeight: 0, evaluated: false, status: "blocked" },
      { category: "deployment", weight: 5, earnedWeight: 0, evaluated: true, status: "not_configured" },
      { category: "database", weight: 5, earnedWeight: 0, evaluated: false, status: "unevaluated" },
    ];

    const html = renderToStaticMarkup(<ReadinessBreakdown breakdown={breakdown} />);

    expect(html).toContain("Verified check failed.");
    expect(html).toContain("Verification could not complete because the DeployGuard sandbox or an external dependency blocked execution.");
    expect(html).toContain("No recognized configuration was detected for this capability.");
    expect(html).toContain("This category was not evaluated in this assessment.");
    expect(html).toContain("border-red-500/30");
    expect(html).toContain("border-amber-500/30");
    expect(html).toContain("border-sky-500/30");
    expect(html).toContain("border-zinc-700");
  });
});
