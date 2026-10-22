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
      if (firstRender) hooks[index] = { value: typeof initial === "function" ? (initial as () => unknown)() : initial };
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

function clickButton(tree: ReactNode, label: string) {
  const element = findElement(tree, (item) => item.type === "button" &&
    (item.props as { children?: string }).children === label);
  if (!element) throw new Error(`${label} button missing`);
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

function responseWithEvents(...events: Array<{ event: string; data: unknown }>) {
  const body = events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(body));
    controller.close();
  } }));
}

const interruptionEvent = (retryable: boolean) => ({
  ok: false, status: "interrupted", stage: "build", service: "Google Fonts",
  reason: retryable ? "approved_build_asset_unavailable" : "approved_build_asset_policy_rejected",
  retryable, message: "Assessment stopped.",
});

const resultEvent = { ok: true, assessment: {
  repository: { owner: "owner", name: "first", fullName: "owner/first",
    url: "https://github.com/owner/first" },
  report: { generatedAt: "first", readiness: { score: 100, coverage: 5, breakdown: [] },
    checks: [], remediation: [] },
} };

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
  it("shows requested then confirmed cancellation without a readiness score", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
    const fetchMock = vi.fn((url: string) => url === "/api/assessment/cancel"
      ? Promise.resolve(Response.json({ ok: true, status: "cancellation_requested" }))
      : Promise.resolve(response));
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard(); assess(tree); await settle(); tree = renderDashboard();
    clickButton(tree, "Cancel Assessment"); await settle(); tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "p" &&
      (item.props as { children?: string }).children ===
        "Cancellation requested. Waiting for server cleanup confirmation.")).not.toBeNull();
    stream.enqueue(new TextEncoder().encode('event: cancelled\ndata: {"ok":false,"status":"cancelled"}\n\n'));
    stream.close();
    await settle(); tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "section" &&
      (item.props as { "aria-label"?: string })["aria-label"] === "Assessment cancelled")).not.toBeNull();
    expect(byType(tree, "ReadinessScoreCard")).toBeNull();
    expect(byType(tree, "ReadinessVerdictCard")).toBeNull();
  });

  it("treats browser stream loss as unconfirmed server execution", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.close(); },
    }));
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard(); assess(tree); await settle(); tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "section" &&
      (item.props as { "aria-label"?: string })["aria-label"] === "Assessment cancelled")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(byType(tree, "ReadinessScoreCard")).toBeNull();
  });

  it("rejects a cancelled stream that also contains a successful result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseWithEvents(
      { event: "cancelled", data: { ok: false, status: "cancelled" } },
      { event: "result", data: resultEvent },
    )));
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard(); assess(tree); await settle(); tree = renderDashboard();
    expect(byType(tree, "ReadinessScoreCard")).toBeNull();
    expect(byType(tree, "ReadinessVerdictCard")).toBeNull();
  });
  it("shows the terminal interruption without a score and retries on request", async () => {
    const event = new TextEncoder().encode(
      'event: interrupted\ndata: {"ok":false,"status":"interrupted","stage":"preparation","service":"package registry","reason":"dependency_registry_unavailable","retryable":true,"message":"Package registry unavailable. Retry Assessment."}\n\n');
    const interruptedResponse = new Response(new ReadableStream({
      start(controller) { controller.enqueue(event); controller.close(); },
    }));
    const fetchMock = vi.fn().mockResolvedValueOnce(interruptedResponse)
      .mockResolvedValueOnce(responseFor("first"));
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    assess(tree);
    await settle();
    tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "p" &&
      (item.props as { children?: string }).children === "Production readiness: Not determined")).not.toBeNull();
    expect(byType(tree, "ReadinessScoreCard")).toBeNull();
    clickButton(tree, "Retry Assessment");
    await settle();
    tree = renderDashboard();
    expect(byType(tree, "ReadinessScoreCard")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not offer Retry Assessment for a non-retryable policy rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseWithEvents({
      event: "interrupted", data: interruptionEvent(false),
    })));
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard(); assess(tree); await settle(); tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "section" &&
      (item.props as { "aria-label"?: string })["aria-label"] === "Assessment interrupted")).not.toBeNull();
    expect(findElement(tree, (item) => item.type === "button" &&
      (item.props as { children?: string }).children === "Retry Assessment")).toBeNull();
    expect(byType(tree, "ReadinessScoreCard")).toBeNull();
    expect(byType(tree, "ReadinessVerdictCard")).toBeNull();
  });

  it.each([
    ["result", "interrupted"],
    ["interrupted", "result"],
  ] as const)("rejects conflicting terminal SSE events: %s then %s", async (first, second) => {
    const event = (kind: "result" | "interrupted") => ({ event: kind,
      data: kind === "result" ? resultEvent : interruptionEvent(true) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseWithEvents(event(first), event(second))));
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard(); assess(tree); await settle(); tree = renderDashboard();
    expect(byType(tree, "ReadinessScoreCard")).toBeNull();
    expect(byType(tree, "ReadinessVerdictCard")).toBeNull();
    expect(findElement(tree, (item) => item.type === "section" &&
      (item.props as { "aria-label"?: string })["aria-label"] === "Assessment interrupted")).toBeNull();
    expect(findElement(tree, (item) => item.type === "p" &&
      typeof (item.props as { children?: unknown }).children === "string" &&
      /Invalid or conflicting|Invalid assessment interruption/.test((item.props as { children: string }).children))).not.toBeNull();
  });

  it("rejects a result followed by a malformed terminal block", async () => {
    const body = `event: result\ndata: ${JSON.stringify(resultEvent)}\n\nevent: interrupted\ndata: {broken}\n\n`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); },
    }))));
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard(); assess(tree); await settle(); tree = renderDashboard();
    expect(byType(tree, "ReadinessVerdictCard")).toBeNull();
    expect(byType(tree, "ReadinessScoreCard")).toBeNull();
    expect(findElement(tree, (item) => item.type === "p" &&
      (item.props as { children?: string }).children === "Malformed final assessment event.")).not.toBeNull();
  });
  it.each([
    ["abc", true],
    ["different-commit", false],
  ] as const)("shows an unsupported remediation only for the current source commit (%s)", async (sourceCommitSha, visible) => {
    const checks = [{ id: "security", category: "security", name: "Security", status: "failed",
      summary: "Vulnerability", evidence: [{ kind: "security_finding", code: "high",
        message: "braces has a high-severity dependency vulnerability.", advisoryIds: ["123"] }] }];
    const explanation = "No explicit targeted fix version is available.";
    const remediation = { sourceCommitSha, repository: { owner: "owner", name: "first",
      fullName: "owner/first", url: "https://github.com/owner/first" },
      remediation: { proposal: { strategy: "dependency_security" },
        execution: { status: "unsupported", summary: explanation } } };
    const fetchMock = vi.fn().mockResolvedValueOnce(responseFor("first", checks))
      .mockResolvedValueOnce(Response.json({ ok: true, remediation }));
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    assess(tree);
    await settle();
    tree = renderDashboard();
    const controlled = byType(tree, "ControlledRemediation");
    expect(controlled).not.toBeNull();
    const candidate = (controlled!.props as { candidates: unknown[] }).candidates[0];
    await (controlled!.props as { onExecute: (candidate: unknown) => Promise<void> }).onExecute(candidate);
    tree = renderDashboard();
    const result = byType(tree, "RemediationProof");
    expect(Boolean(result)).toBe(visible);
    if (visible) {
      const rendered = (result!.type as (props: { result: unknown }) => ReactNode)(result!.props as { result: unknown });
      expect(findElement(rendered, (item) => item.type === "p" &&
        (item.props as { children?: string }).children === explanation)).not.toBeNull();
      expect(findElement(rendered, (item) => item.type === "span" &&
        (item.props as { children?: string }).children === "unsupported")).not.toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("detects offline static scans and retries only after an explicit click", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, repository: {
      fullName: "owner/first", url: "https://github.com/owner/first" }, scan: {} }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: false });
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    clickButton(tree, "Static Scan");
    tree = renderDashboard();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(findElement(tree, (item) => item.type === "button" &&
      (item.props as { children?: string }).children === "Retry Static Scan")).not.toBeNull();
    vi.stubGlobal("navigator", { onLine: true });
    clickButton(tree, "Retry Static Scan");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("warns that a disconnected assessment may still run and requires another click", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(responseFor("first"));
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    assess(tree);
    await settle();
    tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "p" &&
      (item.props as { children?: string }).children === "The assessment connection was interrupted. Check your connection. The previous assessment may still be running on the server. Starting another may run it twice.")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clickButton(tree, "Start Another Assessment");
    await settle();
    tree = renderDashboard();
    expect(byType(tree, "AssessmentSummary")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a successful assessment and its evidence when the browser is offline", async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFor("first"));
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    assess(tree);
    await settle();
    vi.stubGlobal("navigator", { onLine: false });
    tree = renderDashboard();
    assess(tree);
    tree = renderDashboard();
    expect((byType(tree, "AssessmentSummary")?.props as { report: { generatedAt: string } }).report.generatedAt).toBe("first");
    expect(findElement(tree, (item) => item.type === "nav" &&
      (item.props as { "aria-label"?: string })["aria-label"] === "Assessment report sections")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(findElement(tree, (item) => item.type === "p" &&
      (item.props as { children?: string }).children === "You are offline. Reconnect before starting an assessment.")).not.toBeNull();
  });

  it("distinguishes HTTP assessment errors from interrupted streams", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: "Server unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.close(); } })));
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    assess(tree);
    await settle();
    tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "p" &&
      (item.props as { children?: string }).children === "Server unavailable")).not.toBeNull();
    expect(findElement(tree, (item) => item.type === "button" &&
      (item.props as { children?: string }).children === "Start Another Assessment")).toBeNull();
    assess(tree);
    await settle();
    tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "button" &&
      (item.props as { children?: string }).children === "Start Another Assessment")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a server reported stream error distinct from a connection failure", async () => {
    const event = new TextEncoder().encode('event: assessment-error\ndata: {"ok":false,"error":"Verification failed"}\n\n');
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(event); controller.close(); },
    }))));
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    assess(tree);
    await settle();
    tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "p" &&
      (item.props as { children?: string }).children === "Verification failed")).not.toBeNull();
    expect(findElement(tree, (item) => item.type === "button" &&
      (item.props as { children?: string }).children === "Start Another Assessment")).toBeNull();
  });

  it("ignores an intentional abort after the repository changes", async () => {
    let rejectFirst!: (reason: Error) => void;
    const fetchMock = vi.fn((_path: string, options: { body: string }) =>
      JSON.parse(options.body).repositoryUrl.endsWith("/first")
        ? new Promise<Response>((_resolve, reject) => { rejectFirst = reject; })
        : Promise.resolve(responseFor("second")));
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    assess(tree);
    tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/second" } });
    rejectFirst(new DOMException("Aborted", "AbortError"));
    tree = renderDashboard();
    assess(tree);
    await settle();
    tree = renderDashboard();
    expect((byType(tree, "AssessmentSummary")?.props as { report: { generatedAt: string } }).report.generatedAt).toBe("second");
    expect(findElement(tree, (item) => item.type === "button" &&
      (item.props as { children?: string }).children === "Start Another Assessment")).toBeNull();
  });

  it("offers a static scan retry after a connection failure", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ ok: true, repository: {
        fullName: "owner/first", url: "https://github.com/owner/first" }, scan: {} }));
    vi.stubGlobal("fetch", fetchMock);
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    clickButton(tree, "Static Scan");
    await settle();
    tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "button" &&
      (item.props as { children?: string }).children === "Retry Static Scan")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clickButton(tree, "Retry Static Scan");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a static scan HTTP error separate from a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false, error: "Repository unavailable" }, { status: 503 })));
    let tree = renderDashboard();
    input(tree).onChange({ target: { value: "https://github.com/owner/first" } });
    tree = renderDashboard();
    clickButton(tree, "Static Scan");
    await settle();
    tree = renderDashboard();
    expect(findElement(tree, (item) => item.type === "p" &&
      (item.props as { children?: string }).children === "Repository unavailable")).not.toBeNull();
    expect(findElement(tree, (item) => item.type === "button" &&
      (item.props as { children?: string }).children === "Retry Static Scan")).toBeNull();
  });
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
