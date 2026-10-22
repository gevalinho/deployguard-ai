import { readDeveloperSession, sameOrigin } from "@/lib/auth/developer-session";
import { assessmentStatus, requestAssessmentCancellation, validAssessmentId } from
  "@/lib/orchestration/active-assessments";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const developer = readDeveloperSession(request);
  if (!developer) return Response.json({ ok: false }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ ok: false }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const id = typeof body === "object" && body !== null && "assessmentId" in body
    ? body.assessmentId : undefined;
  if (!validAssessmentId(id)) return Response.json({ ok: false }, { status: 400 });
  const status = requestAssessmentCancellation(id, developer.githubId);
  if (!status) return Response.json({ ok: false, status: "unknown" }, { status: 404 });
  return Response.json({ ok: true, status }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const developer = readDeveloperSession(request);
  if (!developer) return Response.json({ ok: false }, { status: 401 });
  const id = new URL(request.url).searchParams.get("assessmentId");
  if (!validAssessmentId(id)) return Response.json({ ok: false }, { status: 400 });
  const status = assessmentStatus(id, developer.githubId);
  if (!status) return Response.json({ ok: false, status: "unknown" }, { status: 404 });
  return Response.json({ ok: true, status }, { headers: { "Cache-Control": "no-store" } });
}
