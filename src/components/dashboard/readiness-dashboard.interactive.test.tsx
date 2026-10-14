import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type HookSlot = { value: unknown; cleanup?: () => void };
const hooks: HookSlot[] = [];
let cursor = 0;
let firstRender = true;
let pendingEffects: Array<() => void | (() => void)> = [];
let unmounted = false;
let writesAfterUnmount = 0;

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState(initial: unknown) {
      const index = cursor++;
      if (firstRender) hooks[index] = { value: initial };
      return [hooks[index].value, (next: unknown) => {
        if (unmounted) writesAfterUnmount++;
        hooks[index].value = typeof next === "function"
          ? (next as (value: unknown) => unknown)(hooks[index].value) : next;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (firstRender) hooks[index] = { value: { current: initial } };
      return hooks[index].value;
    },
    useMemo(factory: () => unknown) { cursor++; return factory(); },
    useCallback(callback: unknown) { cursor++; return callback; },
    useEffect(effect: () => void | (() => void)) {
      const index = cursor++;
      if (firstRender) pendingEffects.push(() => {
        hooks[index] = { value: null, cleanup: effect() ?? undefined };
      });
    },
  };
});

import { ReadinessDashboard } from "./readiness-dashboard";

function renderDashboard() {
  cursor = 0;
  const tree = ReadinessDashboard({ developer: { login: "octocat" } });
  if (firstRender) {
    firstRender = false;
    const effects = pendingEffects;
    pendingEffects = [];
    effects.forEach((effect) => effect());
  }
  return tree;
}

function findElement(tree: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | null {
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const found = findElement(item, predicate);
      if (found) return found;
    }
  }
  if (!tree || typeof tree !== "object" || !("type" in tree)) return null;
  const element = tree as ReactElement<{ children?: ReactNode }>;
  return predicate(element) ? element : findElement(element.props.children, predicate);
}

function byType(tree: ReactNode, name: string) {
  return findElement(tree, (element) =>
    typeof element.type === "function" && element.type.name === name);
}

function input(tree: ReactNode) {
  const element = findElement(tree, (item) => item.type === "input" &&
    (item.props as { id?: string }).id === "repository-url");
  if (!element) throw new Error("Repository input missing");
  return element.props as { value: string; onChange: (event: { target: { value: string } }) => void };
}

function assess(tree: ReactNode) {
  const element = findElement(tree, (item) => item.type === "button" &&
    (item.props as { children?: string }).children === "Assess Repository");
  if (!element) throw new Error("Assessment button missing");
  (element.props as { onClick: () => void }).onClick();
}

function responseFor(repository: string, checks: Array<Record<string, unknown>> = []) {
  const result = { sourceCommitSha: "abc", repository: {
    owner: "owner", name: repository, fullName: `owner/${repository}`,
    url: `https://github.com/owner/${repository}`,
  }, report: { generatedAt: repository, readiness: { score: 80, coverage: 90, breakdown: [] },
    checks, remediation: [] } };
  const bytes = new TextEncoder().encode(`event: result\ndata: ${JSON.stringify({ ok: true, assessment: result })}\n\n`);
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }));
}

async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  hooks.length = 0;
  cursor = 0;
  firstRender = true;
  pendingEffects = [];
  unmounted = false;
  writesAfterUnmount = 0;
  vi.unstubAllGlobals();
  vi.stubGlobal("window", { location: { href: "https://deployguard.test/" },
    history: { state: null, replaceState: vi.fn() }, setTimeout, clearTimeout });
  vi.stubGlobal("sessionStorage", { getItem: vi.fn(() => null), removeItem: vi.fn(), setItem: vi.fn() });
});

describe("dashboard repository interactions", () => {
  it("clears the old report on URL change and completes a second assessment without remounting", async () => {
    const fetchMock = vi.fn((_path: string, options: { body: string }) => {
      const url = JSON.parse(options.body).repositoryUrl as string;
      return Promise.resolve(responseFor(url.endsWith("/first") ? "first" : "second"));
    });
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    assess(tree);
    await settle();
    tree = renderDashboard();
    expect((byType(tree, "AssessmentSummary")?.props as { report: { generatedAt: string } }).report.generatedAt).toBe("first");
    const reportNavigation = findElement(tree, (element) => element.type === "nav" &&
      (element.props as { "aria-label"?: string })["aria-label"] === "Assessment report sections");
    expect(reportNavigation).not.toBeNull();
    expect(findElement(reportNavigation, (element) => element.type === "a" &&
      (element.props as { href?: string }).href === "#verification-checks")).not.toBeNull();
    expect(findElement(reportNavigation, (element) => element.type === "a" &&
      (element.props as { href?: string }).href === "#remediation-plan")).not.toBeNull();

    input(tree).onChange({ target: { value: "https://github.com/owner/second" } });
    tree = renderDashboard();
    expect(byType(tree, "AssessmentSummary")).toBeNull();
    expect(byType(tree, "AssessmentPipeline")).toBeNull();
    assess(tree);
    await settle();
    tree = renderDashboard();
    expect((byType(tree, "AssessmentSummary")?.props as { report: { generatedAt: string } }).report.generatedAt).toBe("second");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resumes the authorized repository even though the URL update invalidates the resume generation", async () => {
    window.location.href = "https://deployguard.test/?github_authorization_return=1";
    const fetchMock = vi.fn((path: string) => Promise.resolve(path.includes("resume")
      ? Response.json({ ok: true, outcome: "success", repositoryUrl: "https://github.com/owner/authorized" })
      : responseFor("authorized")));
    vi.stubGlobal("fetch", fetchMock);
    renderDashboard();
    await settle();
    const tree = renderDashboard();
    expect(input(tree).value).toBe("https://github.com/owner/authorized");
    expect((byType(tree, "AssessmentSummary")?.props as { report: { generatedAt: string } }).report.generatedAt).toBe("authorized");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a late authorization response after switching and avoids writes after unmount", async () => {
    window.location.href = "https://deployguard.test/?github_authorization_return=1";
    let resolveResume!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveResume = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/second" } });
    resolveResume(Response.json({ ok: true, outcome: "success", repositoryUrl: "https://github.com/owner/first" }));
    await settle();
    tree = renderDashboard();
    expect(input(tree).value).toBe("https://github.com/owner/second");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmounted = true;
    hooks.forEach((slot) => slot.cleanup?.());
    await settle();
    expect(writesAfterUnmount).toBe(0);
  });

  it("ignores an older assessment response after a repository switch", async () => {
    let resolveFirst!: (response: Response) => void;
    const fetchMock = vi.fn((_path: string, options: { body: string }) => {
      const url = JSON.parse(options.body).repositoryUrl as string;
      return url.endsWith("/first")
        ? new Promise<Response>((resolve) => { resolveFirst = resolve; })
        : Promise.resolve(responseFor("second"));
    });
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    assess(tree);
    tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/second" } });
    tree = renderDashboard();
    assess(tree);
    await settle();
    resolveFirst(responseFor("first"));
    await settle();
    tree = renderDashboard();
    expect((byType(tree, "AssessmentSummary")?.props as { report: { generatedAt: string } }).report.generatedAt).toBe("second");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not write state after unmount while an assessment response is pending", async () => {
    let resolveAssessment!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveAssessment = resolve; })));
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    assess(tree);
    unmounted = true;
    hooks.forEach((slot) => slot.cleanup?.());
    resolveAssessment(responseFor("first"));
    await settle();
    expect(writesAfterUnmount).toBe(0);
  });

  it("ignores an assessment click handler captured before the URL changed", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    const oldButton = findElement(tree, (item) => item.type === "button" &&
      (item.props as { children?: string }).children === "Assess Repository");
    input(tree).onChange({ target: { value: "https://github.com/owner/second" } });
    (oldButton?.props as { onClick: () => void }).onClick();
    tree = renderDashboard();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input(tree).value).toBe("https://github.com/owner/second");
    expect((findElement(tree, (item) => item.type === "button" &&
      (item.props as { children?: string }).children === "Assess Repository")?.props as { disabled: boolean }).disabled).toBe(false);
  });

  it("copies only the current assessment and reports clipboard failure accessibly", async () => {
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) };
    vi.stubGlobal("navigator", { clipboard });
    vi.stubGlobal("fetch", vi.fn((_path: string, options: { body: string }) => {
      const url = JSON.parse(options.body).repositoryUrl as string;
      const name = url.endsWith("/first") ? "first" : "second";
      return Promise.resolve(responseFor(name, [{ id: "build", category: "build", name: "Build",
        status: "failed", summary: "private token" }]));
    }));
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    assess(tree);
    await settle();
    tree = renderDashboard();
    const oldCopy = findElement(tree, (item) => item.type === "button" &&
      (item.props as { children?: string }).children === "Copy AI Context");
    (oldCopy?.props as { onClick: () => void }).onClick();
    await settle();
    tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "p" &&
      (item.props as { role?: string; children?: string }).role === "status" &&
      String((item.props as { children?: string }).children).includes("Could not access the clipboard"))).not.toBeNull();

    input(tree).onChange({ target: { value: "https://github.com/owner/second" } });
    (oldCopy?.props as { onClick: () => void }).onClick();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    tree = renderDashboard();
    assess(tree);
    await settle();
    clipboard.writeText.mockResolvedValue(undefined);
    tree = renderDashboard();
    const finding = byType(tree, "VerificationChecks");
    (finding?.props as { onCopyFinding: (index: number) => void }).onCopyFinding(0);
    await settle();
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
    const copied = clipboard.writeText.mock.calls[1]?.[0] as string;
    expect(copied).toContain("Repository: owner/second");
    expect(copied).not.toContain("private token");
  });
});
