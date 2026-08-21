import { NextRequest, NextResponse } from "next/server";
import { getOfflinePreferences, setOfflinePreferences } from "@/lib/offlinePreferences";

export const runtime = "nodejs";

/** user_key del usuario actual (mismo criterio que el login: username || userid). */
function getUserKey(req: NextRequest): string | null {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return null;
  try {
    const u = JSON.parse(raw) as { userid?: number | string; username?: string };
    return u.username || (u.userid != null ? String(u.userid) : null);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const userKey = getUserKey(req);
  if (!userKey) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const prefs = await getOfflinePreferences(userKey);
  return NextResponse.json({ filesEnabled: prefs.filesEnabled, onboardingSeen: prefs.onboardingSeenAt !== null });
}

export async function POST(req: NextRequest) {
  const userKey = getUserKey(req);
  if (!userKey) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const patch: { filesEnabled?: boolean; onboardingSeenAt?: string } = {};
  if (typeof body?.filesEnabled === "boolean") patch.filesEnabled = body.filesEnabled;
  if (body?.onboardingSeen === true) patch.onboardingSeenAt = new Date().toISOString();

  const ok = await setOfflinePreferences(userKey, patch);
  if (!ok) return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
