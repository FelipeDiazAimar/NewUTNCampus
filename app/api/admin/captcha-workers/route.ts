// Monitor de workers del captcha remoto para /admin/dashboard.

import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONECTADA_MS = 30000; // heartbeat más viejo que esto => desconectada

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  let rows: Array<Record<string, unknown>> = [];
  try {
    const res = await supabaseFetch(
      "captcha_workers?select=*&order=actualizado.desc",
      { method: "GET" }
    );
    if (res.ok) rows = await res.json();
  } catch {
    /* devolvemos lista vacía */
  }
  const ahora = Date.now();
  const workers = rows.map((r) => {
    const haceMs = ahora - new Date(String(r.actualizado)).getTime();
    const desde = r.proceso_desde ? new Date(String(r.proceso_desde)).getTime() : 0;
    return {
      ...r,
      hace_ms: haceMs,
      activa_hace_ms: desde ? ahora - desde : null,
      conectada: r.estado === "activo" && haceMs < CONECTADA_MS,
    };
  });
  return NextResponse.json({ workers, ahora: new Date(ahora).toISOString() });
}
