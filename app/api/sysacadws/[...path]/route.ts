import { NextRequest, NextResponse } from "next/server";
import { SYSACADWS_BASE } from "@/lib/sysacadws";

export const runtime = "nodejs";

/**
 * Proxy genérico al web service de Sysacad. Reenvía cualquier ruta bajo
 * sysacadws/{...} agregando el header Basic guardado en la cookie httpOnly.
 * Evita CORS y mantiene oculta la credencial del alumno.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const auth = req.cookies.get("sysacadws_auth")?.value;
  if (!auth) {
    return NextResponse.json({ error: "No autenticado en Sysacad." }, { status: 401 });
  }

  const { path } = await params;
  // Solo segmentos simples (sin escapar de la base del WS).
  if (!path?.length || path.some((seg) => !/^[\w.@-]+$/.test(seg))) {
    return NextResponse.json({ error: "Ruta inválida." }, { status: 400 });
  }

  const url = `${SYSACADWS_BASE}/${path.join("/")}${req.nextUrl.search}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, cache: "no-store" });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    console.error("[sysacadws-proxy]", (err as Error).message);
    return NextResponse.json({ error: "No se pudo conectar con Sysacad." }, { status: 502 });
  }
}
