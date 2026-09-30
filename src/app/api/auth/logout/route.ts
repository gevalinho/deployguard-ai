import { cookieOptions, sameOrigin, SESSION_COOKIE } from "@/lib/auth/developer-session";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  return new Response(null, { status: 204, headers: { "Set-Cookie": `${SESSION_COOKIE}=; ${cookieOptions(0)}` } });
}
