import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { join } from "node:path";
import type { ReactElement } from "react";
// Deterministic hook harness exercises real component callbacks without browser/network.
const require = createRequire(join(process.cwd(), "package.json"));
const realReact = require("react");
let values: unknown[] = [], cursor = 0;
let effects: Array<() => void> = [];
let mounted = false;
function stub(path: string, exports: Record<string, unknown>) {
  const id = require.resolve(path); const cachedModule = new Module(id); cachedModule.exports = exports; require.cache[id] = cachedModule;
}
stub("react", { ...realReact,
  useState(initial: unknown) { const slot = cursor++; if (!(slot in values)) values[slot] = initial;
    return [values[slot], (value: unknown) => { values[slot] = value; }]; },
  useRef(initial: unknown) { const slot = cursor++; if (!(slot in values)) values[slot] = { current: initial }; return values[slot]; },
  useEffect(effect: () => void) { if (!mounted) effects.push(effect); },
});
stub("next/navigation", { useRouter: () => ({ refresh() {} }) });
const { RemediationDelivery } = require("@/components/dashboard/remediation-delivery") as typeof import("@/components/dashboard/remediation-delivery");
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value),
} });
type Node = ReactElement<{ children?: unknown; disabled?: boolean; onClick?: () => void; href?: string; role?: string }>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "props" in value) return text((value as Node).props.children);
  return "";
}
const source = { repositoryIdentity: "owner/repo", sourceCommitSha: "a".repeat(40) };
let props: Parameters<typeof RemediationDelivery>[0] = { developer: null, artifactId: "artifact123", generated: true, deliveryEligible: true, ...source };
function render() { cursor = 0; const tree = RemediationDelivery(props); mounted = true; return tree; }
const button = (name: string) => nodes(render()).find(n => n.type === "button" && text(n) === name)!;
const tick = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
const calls: Array<{ url: string; init?: RequestInit }> = [];
let response: () => Promise<Response>;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return response(); };
const delivery = { artifactId: "artifact123", deliveryId: "delivery123", repositoryIdentity: "owner/repo", status: "PUSHED",
  branchName: "deployguard/remediation-aaaaaaaaaaaa", commitSha: "c".repeat(40) };
async function main() {
  props = { developer: { login: "developer" }, artifactId: "artifact123", generated: true, deliveryEligible: false, ...source };
  assert(button("Confirm branch delivery").props.disabled);
  assert(text(render()).includes("unavailable; source provenance was not verified"));
  values = []; mounted = false; effects = [];
  props = { developer: null, artifactId: "artifact123", generated: true, deliveryEligible: true, ...source };
  assert(button("Confirm branch delivery").props.disabled);
  nodes(render()).find(n => n.props.href === "/api/auth/github/start")!.props.onClick!();
  assert.deepEqual(JSON.parse(storage.get("deployguard-delivery-workflow")!), { artifactId: "artifact123", ...source });
  // Simulate OAuth remount: restoring state alone must not send any request.
  values = []; mounted = false; effects = []; props = { developer: { login: "developer" }, generated: false, ...source };
  render(); effects.forEach(effect => effect()); await tick(); render();
  assert.equal(calls.length, 0); assert(button("Confirm branch delivery").props.disabled);
  values = []; mounted = false; effects = []; props = { developer: { login: "developer" }, artifactId: "artifact123", generated: true, deliveryEligible: true, ...source };
  assert(button("Confirm pull request creation").props.disabled);
  let release: (value: Response) => void = () => {};
  response = () => new Promise(resolve => { release = resolve; });
  const click = button("Confirm branch delivery").props.onClick!;
  click(); click(); assert.equal(calls.length, 1); assert(button("Confirm branch delivery").props.disabled);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { artifactId: "artifact123", confirmDelivery: true });
  release(Response.json({ ok: true, delivery })); await tick();
  assert.equal(calls.length, 1, "Successful push must not trigger PR creation");
  assert(!button("Confirm pull request creation").props.disabled);
  response = async () => Response.json({ ok: false, code: "recovery_required", error: "Review required" }, { status: 409 });
  button("Confirm pull request creation").props.onClick!(); await tick();
  assert.equal(calls.length, 2); assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { confirmPullRequest: true });
  assert(text(render()).includes("Conflict / recovery")); await tick(); assert.equal(calls.length, 2);
  response = async () => Response.json({ ok: true, delivery: { ...delivery, pullRequestStatus: "POST_ATTEMPTED" } });
  button("Refresh delivery status").props.onClick!(); await tick();
  assert.equal(calls.at(-1)?.init?.method, "GET"); assert(text(render()).includes("outcome uncertain"));
  for (const status of ["PREPARED", "COMMITTED", "PUSHED"]) {
    response = async () => Response.json({ ok: true, delivery: { ...delivery, status } });
    button("Refresh delivery status").props.onClick!(); await tick();
    assert(text(render()).includes(status.toLowerCase()));
    assert.equal(Boolean(button("Confirm pull request creation").props.disabled), status !== "PUSHED");
  }
  response = async () => Response.json({ ok: true, delivery: { ...delivery, pullRequestStatus: "VERIFIED",
    pullRequest: { number: 1, url: "https://github.com/owner/repo/pull/1", state: "open" } } });
  button("Refresh delivery status").props.onClick!(); await tick();
  assert(nodes(render()).some(n => n.props.href === "https://github.com/owner/repo/pull/1"));
  assert(button("Confirm pull request creation").props.disabled);
  for (const state of ["open", "merged", "closed"]) {
    response = async () => Response.json({ ok: true, delivery: { ...delivery, pullRequestStatus: "VERIFIED",
      pullRequest: { number: 1, url: "https://github.com/owner/repo/pull/1", state } } });
    button("Refresh delivery status").props.onClick!(); await tick();
    assert(text(render()).includes(`verified (${state})`));
  }
  response = async () => Response.json({ ok: false, error: "GitHub unavailable" }, { status: 503 });
  button("Refresh delivery status").props.onClick!(); await tick();
  assert(text(render()).includes("verified (closed, last known; refresh failed)"));
  assert(nodes(render()).some(n => n.props.href === "https://github.com/owner/repo/pull/1"));
  response = async () => Response.json({ ok: false, error: "Sign-in required" }, { status: 401 });
  button("Refresh delivery status").props.onClick!(); await tick(); assert(text(render()).includes("Authorization"));
  assert.deepEqual(JSON.parse(storage.get("deployguard-delivery-workflow")!), { artifactId: "artifact123", deliveryId: "delivery123", ...source });
  console.log("Dashboard explicit intent, OAuth restoration, duplicate click, status and recovery tests passed (hook harness).");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
