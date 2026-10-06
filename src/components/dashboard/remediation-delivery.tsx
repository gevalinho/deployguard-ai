"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Delivery = {
  artifactId: string; deliveryId: string; repositoryIdentity: string;
  status: "PREPARED" | "COMMITTED" | "PUSHED" | "FAILED";
  branchName: string; commitSha: string | null;
  pullRequestStatus?: "CLAIMED" | "POST_ATTEMPTED" | "VERIFIED";
  pullRequest?: { number: number; url: string; state: string };
};
type Workflow = { artifactId?: string; deliveryId?: string; deliveryEligible?: boolean };
const storageKey = "deployguard-delivery-workflow";
function savedWorkflow(): Workflow {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
    if (!value || typeof value !== "object") return {};
    const opaque = (v: unknown) => typeof v === "string" && /^[a-z0-9]{8,64}$/.test(v) ? v : undefined;
    return { artifactId: opaque(value.artifactId), deliveryId: opaque(value.deliveryId), deliveryEligible: value.deliveryEligible === true };
  } catch { return {}; }
}
function save(value: Workflow) {
  try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Optional navigation continuity. */ }
}

export function RemediationDelivery({ developer, artifactId, generated, deliveryEligible = false }: {
  developer: { login: string } | null; artifactId?: string; generated: boolean; deliveryEligible?: boolean;
}) {
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow>({ artifactId, deliveryEligible });
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState<"delivery" | "pr" | "status" | "logout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusStale, setStatusStale] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    // Restore identifiers only. OAuth return never starts a request or mutation.
    let active = true;
    Promise.resolve().then(() => {
      if (active && !artifactId && !generated) setWorkflow(savedWorkflow());
    });
    return () => { active = false; };
  }, [artifactId, generated]);

  async function act(action: "delivery" | "pr" | "status" | "logout") {
    if (lock.current) return;
    lock.current = true;
    setBusy(action); setError(null);
    try {
      const id = delivery?.deliveryId ?? workflow.deliveryId;
      const path = action === "logout" ? "/api/auth/logout" : action === "delivery" ? "/api/remediation/delivery" :
        `/api/remediation/delivery/${encodeURIComponent(id ?? "")}${action === "pr" ? "/pull-request" : ""}`;
      const response = await fetch(path, {
        method: action === "status" ? "GET" : "POST", cache: "no-store",
        ...(action !== "status" && action !== "logout" ? { headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "pr" ? { confirmPullRequest: true } :
            { artifactId: workflow.artifactId, confirmDelivery: true }) } : {}),
      });
      if (action === "logout") {
        if (!response.ok) throw new Error("Sign-out failed.");
        save(workflow); router.refresh(); return;
      }
      const result = await response.json();
      if (!response.ok || !result.ok) {
        const category = response.status === 401 || response.status === 403 ? "Authorization" :
          response.status === 409 ? "Conflict / recovery" : "Recovery review";
        throw new Error(`${category}: ${result.code ? `${result.code}. ` : ""}${result.error ?? "Request failed."}`);
      }
      const next = result.delivery as Delivery;
      setDelivery(next);
      setStatusStale(false);
      const reference = { artifactId: next.artifactId, deliveryId: next.deliveryId, deliveryEligible: true };
      setWorkflow(reference); save(reference);
    } catch (failure) {
      if (action === "status") setStatusStale(true);
      setError(failure instanceof Error ? failure.message : "Request failed; review delivery status before continuing.");
    } finally { lock.current = false; setBusy(null); }
  }
  const button = "rounded-lg border border-zinc-600 px-4 py-2 text-sm disabled:opacity-40";
  return <section aria-label="Remediation delivery" className="my-8 rounded-2xl border border-zinc-700 bg-zinc-900 p-5 space-y-4">
    <h2 className="text-lg font-semibold">GitHub remediation delivery</h2>
    <div className="flex flex-wrap items-center gap-3">
      {developer ? <><span>Signed in as {developer.login}</span>
        <button className={button} disabled={!!busy} onClick={() => void act("logout")}>Sign out</button></> :
        <a className={button} href="/api/auth/github/start" onClick={() => save(workflow)}>Sign in with GitHub</a>}
    </div>
    <ol className="space-y-2 text-sm text-zinc-300">
      <li>Remediation: {generated ? "generated" : workflow.artifactId ? "saved workflow; refresh delivery status when available" : "not generated"}</li>
      <li>Artifact: {artifactId ? "verified and persisted" : workflow.artifactId ? "saved reference; server verification required" : "no verified artifact available"}</li>
      <li>GitHub delivery: {workflow.artifactId ? workflow.deliveryEligible ? "eligible for verification at delivery" : "unavailable; remote repository identity was not verified" : "not available"}</li>
      <li>Delivery: {busy === "delivery" ? "preparing, committing, and pushing; awaiting verified result" : delivery ? delivery.status.toLowerCase() : workflow.deliveryId ? "saved delivery; refresh status" : "not requested"}</li>
      <li>Pull request: {busy === "pr" ? "creation pending verification" : delivery?.pullRequest ? `verified (${delivery.pullRequest.state}${statusStale ? ", last known; refresh failed" : ""})` : delivery?.pullRequestStatus === "POST_ATTEMPTED" ? "outcome uncertain; recovery review required" : delivery?.pullRequestStatus === "CLAIMED" ? "creation pending; recovery review may be required" : "not verified"}</li>
    </ol>
    {delivery && <p className="text-sm text-zinc-400">{delivery.repositoryIdentity} · {delivery.branchName}</p>}
    <div className="flex flex-wrap gap-3">
      <button className={button} disabled={!developer || !workflow.artifactId || !workflow.deliveryEligible || !!busy || !!delivery}
        onClick={() => void act("delivery")}>Confirm branch delivery</button>
      <button className={button} disabled={!developer || !(delivery?.deliveryId ?? workflow.deliveryId) || !!busy}
        onClick={() => void act("status")}>Refresh delivery status</button>
      <button className={button} disabled={!developer || delivery?.status !== "PUSHED" || !!delivery?.pullRequest || !!busy}
        onClick={() => void act("pr")}>Confirm pull request creation</button>
      {delivery?.pullRequest && <a className={button} href={delivery.pullRequest.url} target="_blank" rel="noopener noreferrer">View verified PR #{delivery.pullRequest.number}</a>}
    </div>
    <p className="text-sm text-zinc-400">Delivery pushes a remediation branch. Pull request creation requires a separate confirmation. After sign-in, continue manually. Conflicts and uncertain attempts require review; requests are never automatically retried.</p>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </section>;
}
