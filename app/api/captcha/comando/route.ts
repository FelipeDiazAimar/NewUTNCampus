// Canal de comandos supervisor <-> web (sin SSH).
//   GET  /api/captcha/comando?id=X   -> el supervisor consulta si hay comando
//   POST /api/captcha/comando        -> el supervisor confirma que lo ejecutó
// Ambos con header x-worker-secret = CAPTCHA_HEARTBEAT_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function autorizado(req: NextRequest): boolean {
  const s = process.env.CAPTCHA_HEARTBEAT_SECRET;
  return !!s && req.headers.get("x-worker-secret") === s;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "no" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id")?.slice(0, 80) || "";
  if (!id) return NextResponse.json({ error: "falta id" }, { status: 400 });
  try {
    const res = await supabaseFetch(
      `captcha_workers?select=comando,comando_nonce,comando_ack&id=eq.${encodeURIComponent(id)}`,
      { method: "GET" }
    );
    const rows = res.ok ? ((await res.json()) as Array<Record<string, unknown>>) : [];
    const r = rows[0];
    if (r && r.comando && !r.comando_ack) {
      return NextResponse.json({ cmd: r.comando, nonce: r.comando_nonce });
    }
    return NextResponse.json({ cmd: null });
  } catch {
    return NextResponse.json({ cmd: null });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "no" }, { status: 401 });
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "body" }, { status: 400 });
  }
  const id = String(b.id || "").slice(0, 80);
  const nonce = String(b.nonce || "").slice(0, 64);
  if (!id || !nonce) return NextResponse.json({ error: "falta id/nonce" }, { status: 400 });
  try {
    await supabaseFetch(
      `captcha_workers?id=eq.${encodeURIComponent(id)}&comando_nonce=eq.${encodeURIComponent(nonce)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ comando_ack: new Date().toISOString() }),
      }
    );
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
