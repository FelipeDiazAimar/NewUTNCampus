// Endpoint runtime: devuelve las wss_url de los workers del captcha remoto que
// están vivos (heartbeat reciente). El cliente (CaptchaRemoto.tsx) lo consulta
// si no hay NEXT_PUBLIC_CAPTCHA_WS_URL fijo, así no hay que reconfigurar Vercel
// cada vez que el túnel del worker cambia de URL.
//
// Gateado por la sesión del campus: solo un usuario logueado descubre la URL
// del worker (evita que cualquiera lo use de resolvedor / navegue turnos).

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FRESCO_MS = 40000; // sin heartbeat en 40s => se considera caído

function tieneSesionApp(req: NextRequest): boolean {
  const cookie = req.headers.get("cookie") || "";
  return /moodle_user=|sysacadws_auth=/.test(cookie);
}

export async function GET(req: NextRequest) {
  if (!tieneSesionApp(req)) return NextResponse.json({ urls: [] });
  try {
    const res = await supabaseFetch(
      "captcha_workers?select=id,wss_url,actualizado,estado&estado=eq.activo&order=actualizado.desc",
      { method: "GET" }
    );
    if (!res.ok) return NextResponse.json({ urls: [] });
    const rows = (await res.json()) as Array<{ wss_url?: string; actualizado: string }>;
    const ahora = Date.now();
    const urls = rows
      .filter((r) => r.wss_url && ahora - new Date(r.actualizado).getTime() < FRESCO_MS)
      .map((r) => r.wss_url as string);
    return NextResponse.json({ urls });
  } catch {
    return NextResponse.json({ urls: [] });
  }
}
