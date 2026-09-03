// El admin encola un comando para el supervisor de un worker (lo ejecuta el
// supervisor en su próximo poll de GET /api/captcha/comando).

import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALIDOS = new Set(["reiniciar", "frenar", "arrancar"]);

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }
  const id = String(b.id || "").slice(0, 80);
  const cmd = String(b.cmd || "");
  if (!id || !VALIDOS.has(cmd)) {
    return NextResponse.json({ error: "id o cmd inválido" }, { status: 400 });
  }
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    const res = await supabaseFetch(`captcha_workers?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        comando: cmd,
        comando_nonce: nonce,
        comando_pedido: new Date().toISOString(),
        comando_ack: null,
        comando_por: "admin",
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: (await res.text()).slice(0, 200) }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, nonce });
}
