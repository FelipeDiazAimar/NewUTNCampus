import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";

/** userId (moodle userid) desde la cookie legible del campus. */
function getUserId(req: NextRequest): string | null {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return null;
  try {
    const u = JSON.parse(raw) as { userid?: number | string };
    return u.userid != null ? String(u.userid) : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  try {
    const res = await supabaseFetch(
      `custom_schedule_events?user_id=eq.${encodeURIComponent(userId)}&order=start_time.asc`
    );
    if (!res.ok) return NextResponse.json({ error: "Supabase" }, { status: 502 });
    return NextResponse.json({ data: await res.json() });
  } catch {
    return NextResponse.json({ error: "DB no configurada" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { title, description, dayOfWeek, startTime, endTime, colorHex } = body;
  if (!title || dayOfWeek == null || !startTime || !endTime) {
    return NextResponse.json({ error: "Faltan campos obligatorios." }, { status: 400 });
  }

  try {
    const res = await supabaseFetch("custom_schedule_events", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: userId,
        title: String(title).slice(0, 120),
        description: description ? String(description).slice(0, 400) : null,
        day_of_week: Number(dayOfWeek),
        start_time: String(startTime),
        end_time: String(endTime),
        color_hex: String(colorHex || "#007aff"),
      }),
    });
    if (!res.ok) return NextResponse.json({ error: "No se pudo guardar." }, { status: 502 });
    const rows = await res.json();
    return NextResponse.json({ event: Array.isArray(rows) ? rows[0] : rows });
  } catch {
    return NextResponse.json({ error: "DB no configurada" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id." }, { status: 400 });
  try {
    const res = await supabaseFetch(
      `custom_schedule_events?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: "DELETE" }
    );
    if (!res.ok) return NextResponse.json({ error: "No se pudo eliminar." }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "DB no configurada" }, { status: 503 });
  }
}
