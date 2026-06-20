import { NextRequest, NextResponse } from "next/server";
import { listDeviceSessions, revokeDeviceSessions } from "@/lib/deviceSessions";

export const runtime = "nodejs";

const DEVICE_COOKIE = "campus_device_id";

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

// Lista las sesiones (dispositivos) activas del usuario, marcando la actual.
export async function GET(req: NextRequest) {
  const userKey = getUserKey(req);
  if (!userKey) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const currentId = req.cookies.get(DEVICE_COOKIE)?.value ?? null;
  const rows = await listDeviceSessions(userKey);

  const sessions = rows.map((r) => ({
    deviceId: r.device_id,
    userAgent: r.user_agent,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
    current: r.device_id === currentId,
  }));

  return NextResponse.json({ sessions });
}

// Revoca sesiones. Body: { scope: "others" } | { deviceId: "..." }.
export async function DELETE(req: NextRequest) {
  const userKey = getUserKey(req);
  if (!userKey) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const currentId = req.cookies.get(DEVICE_COOKIE)?.value ?? undefined;
  const body = await req.json().catch(() => ({}));

  let ok: boolean;
  if (body?.deviceId) {
    if (body.deviceId === currentId) {
      return NextResponse.json({ error: "Usá cerrar sesión para el dispositivo actual." }, { status: 400 });
    }
    ok = await revokeDeviceSessions({ userKey, onlyDeviceId: body.deviceId });
  } else {
    // Por defecto: cerrar en todos los demás dispositivos.
    ok = await revokeDeviceSessions({ userKey, exceptDeviceId: currentId });
  }

  if (!ok) return NextResponse.json({ error: "No se pudo cerrar las sesiones." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
