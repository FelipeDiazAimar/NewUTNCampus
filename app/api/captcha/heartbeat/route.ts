// Recibe el heartbeat del worker del captcha remoto (scripts/captcha-remoto/
// server.mts) y lo upsertea en Supabase (captcha_workers). Lo lee
// /admin/dashboard y /api/captcha/endpoint.

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
};

export async function POST(req: NextRequest) {
  const secret = process.env.CAPTCHA_HEARTBEAT_SECRET;
  if (!secret || req.headers.get("x-worker-secret") !== secret) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }
  const id = String(b.id || "").slice(0, 80);
  if (!id) return NextResponse.json({ error: "falta id" }, { status: 400 });

  const fila = {
    id,
    actualizado: new Date().toISOString(),
    proceso_desde: b.proceso_desde ? String(b.proceso_desde) : null,
    wss_url: b.wss_url ? String(b.wss_url).slice(0, 300) : null,
    version: b.version ? String(b.version).slice(0, 40) : null,
    estado: b.estado === "apagado" ? "apagado" : "activo",
    motivo: b.motivo ? String(b.motivo).slice(0, 200) : null,
    conex_total: n(b.conex_total),
    conex_actual: n(b.conex_actual),
    conex_max: n(b.conex_max),
    en_cola: n(b.en_cola),
    pool: n(b.pool),
    errores: n(b.errores),
    rechazos: n(b.rechazos),
    rt_ultimo_ms: n(b.rt_ultimo_ms),
    rt_prom_ms: n(b.rt_prom_ms),
    rt_max_ms: n(b.rt_max_ms),
    rt_min_ms: n(b.rt_min_ms),
  };

  try {
    const res = await supabaseFetch("captcha_workers?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(fila),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "supabase", detalle: (await res.text()).slice(0, 200) },
        { status: 502 }
      );
    }
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
