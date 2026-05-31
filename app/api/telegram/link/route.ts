import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseFetch } from "@/lib/supabase";

function getUserKey(req: NextRequest): string | null {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { username?: string; userid?: number };
    return parsed.username ?? (parsed.userid ? String(parsed.userid) : null);
  } catch {
    return null;
  }
}

async function ensureProfile(email: string) {
  const res = await supabaseFetch(
    `perfil_notificaciones?email=eq.${encodeURIComponent(email)}&select=*`
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ id: string }>;
  if (rows[0]) return rows[0];

  const insertRes = await supabaseFetch("perfil_notificaciones?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      email,
      notificaciones_globales_activas: true,
    }),
  });
  if (!insertRes.ok) return null;
  const inserted = (await insertRes.json()) as Array<{ id: string }>;
  return inserted[0] ?? null;
}

export async function POST(req: NextRequest) {
  const email = getUserKey(req);
  if (!email) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "";
  if (!botUsername) {
    return NextResponse.json({ error: "Falta TELEGRAM_BOT_USERNAME" }, { status: 500 });
  }

  const profile = await ensureProfile(email);
  if (!profile) {
    return NextResponse.json({ error: "No se pudo crear el perfil" }, { status: 500 });
  }

  const linkCode = randomUUID().slice(0, 8);
  await supabaseFetch(`perfil_notificaciones?email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ telegram_link_code: linkCode }),
  });

  const url = `https://t.me/${botUsername}?start=${linkCode}`;
  return NextResponse.json({ url });
}
