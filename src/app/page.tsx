import { cookies } from "next/headers";
import { ReadinessDashboard } from "@/components/dashboard/readiness-dashboard";
import { readDeveloperSession, SESSION_COOKIE } from "@/lib/auth/developer-session";

export default async function Home() {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  let developer: { login: string } | null = null;
  try {
    const session = readDeveloperSession(new Request("https://deployguard.internal", {
      headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
    }));
    if (session) developer = { login: session.login };
  } catch { /* Missing/invalid signing configuration cannot establish a session. */ }
  return <ReadinessDashboard developer={developer} />;
}
