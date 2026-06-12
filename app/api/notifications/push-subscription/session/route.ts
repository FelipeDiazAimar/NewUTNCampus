/**
 * POST /api/notifications/push-subscription/session
 *
 * Actualiza los campos moodle_session_token / moodle_sesskey para todas las
 * suscripciones activas del usuario actual. Se llama en background desde
 * SessionGuard cada vez que el keepalive de Moodle tiene éxito, asegurando que
 * el cron de notificaciones de chat siempre tenga una sesión válida.
 *
 * No requiere body — lee la sesión desde las cookies httpOnly del request.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";

function getUserKey(req: NextRequest): string | null {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { username?: string; userid?: number };
    return p.username ?? (p.userid ? String(p.userid) : null);
  } catch {
    return null;
  }
}

export async function GET() {
  return new NextResponse(null, { status: 405 });
}

export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const sesskey = req.cookies.get("moodle_sesskey")?.value;
  const userKey = getUserKey(req);

  if (!sessionToken || !userKey) {
    return NextResponse.json({ ok: false }, { status: 200 }); // silencioso
  }

  await supabaseFetch(
    `web_push_subscriptions?user_key=eq.${encodeURIComponent(userKey)}&active=eq.true`,
    {
      method: "PATCH",
      body: JSON.stringify({
        moodle_session_token: sessionToken,
        moodle_sesskey: sesskey ?? null,
        updated_at: new Date().toISOString(),
      }),
    }
  ).catch(() => {}); // fire-and-forget, no bloqueamos el keepalive

  return NextResponse.json({ ok: true });
}
