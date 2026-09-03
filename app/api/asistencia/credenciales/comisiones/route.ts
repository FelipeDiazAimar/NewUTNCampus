// El daemon reporta acá qué comisiones ve cada cuenta (mapa de descubrimiento).
// Gated por x-worker-secret. Maneja el contador de strikes (0 comisiones seguidas).

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFICATIONS_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-worker-secret") !== secret) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  let b: { legajo?: string; comisiones?: unknown[] };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }
  const legajo = String(b.legajo || "").trim();
  const comisiones = Array.isArray(b.comisiones) ? b.comisiones : [];
  if (!legajo) return NextResponse.json({ error: "falta legajo" }, { status: 400 });

  // strikes: +1 si vino vacío, 0 si trajo comisiones.
  let strikes = 0;
  if (comisiones.length === 0) {
    try {
      const res = await supabaseFetch(
        `asistencia_credenciales?select=strikes&legajo=eq.${encodeURIComponent(legajo)}`
      );
      if (res.ok) {
        const rows = (await res.json()) as { strikes: number }[];
        strikes = (rows[0]?.strikes ?? 0) + 1;
      }
    } catch {
      strikes = 1;
    }
    if (strikes >= 3) {
      console.warn(
        `[asistencia/comisiones] legajo ${legajo}: ${strikes} descubrimientos con 0 comisiones`
      );
    }
  }

  try {
    await supabaseFetch(`asistencia_credenciales?legajo=eq.${encodeURIComponent(legajo)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        comisiones,
        comisiones_at: new Date().toISOString(),
        strikes,
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
