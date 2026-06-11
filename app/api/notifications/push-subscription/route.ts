import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";

type PushSubscriptionJSON = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

function getUserKey(req: NextRequest): string {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return "anonymous";

  try {
    const parsed = JSON.parse(raw) as { username?: string; userid?: number };
    return parsed.username ?? (parsed.userid ? String(parsed.userid) : "anonymous");
  } catch {
    return "anonymous";
  }
}

export async function POST(req: NextRequest) {
  const subscription = (await req.json()) as PushSubscriptionJSON;

  if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return NextResponse.json({ error: "Suscripcion push invalida" }, { status: 400 });
  }

  const userKey = getUserKey(req);

  // Lee la sesión Moodle activa para que el cron pueda llamar a Moodle por este usuario.
  const moodleSessionToken = req.cookies.get("moodle_session_token")?.value ?? null;
  const moodleSesskey = req.cookies.get("moodle_sesskey")?.value ?? null;
  let moodleUserid: number | null = null;
  try {
    moodleUserid = Number(JSON.parse(req.cookies.get("moodle_user")?.value ?? "{}").userid) || null;
  } catch { /* ignore */ }

  const res = await supabaseFetch("web_push_subscriptions?on_conflict=endpoint", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      user_key: userKey,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: req.headers.get("user-agent"),
      active: true,
      updated_at: new Date().toISOString(),
      // Sesión Moodle — se actualiza cada vez que el usuario suscribe / refresca.
      moodle_session_token: moodleSessionToken,
      moodle_sesskey: moodleSesskey,
      moodle_userid: moodleUserid,
      last_chat_unread: 0,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json(
      { error: "No se pudo guardar la suscripcion push", detail },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) {
    return NextResponse.json({ error: "Endpoint requerido" }, { status: 400 });
  }

  const res = await supabaseFetch(
    `web_push_subscriptions?endpoint=eq.${encodeURIComponent(body.endpoint)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "No se pudo desactivar la suscripcion" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
