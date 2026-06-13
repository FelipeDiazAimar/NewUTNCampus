import { NextRequest, NextResponse } from "next/server";
import { SYSACADWS_BASE } from "@/lib/sysacadws";
import { isGuestRequest } from "@/lib/guest";
import {
  MOCK_DATOS_PERSONALES,
  MOCK_CURSADO,
  MOCK_ESTADO_ACADEMICO,
  MOCK_AVANCE,
  MOCK_EXAMENES,
  MOCK_PLAN,
  MOCK_INASISTENCIAS,
  MOCK_CORRELATIVIDADES,
} from "@/lib/guestMockData";

export const runtime = "nodejs";

/**
 * Proxy genérico al web service de Sysacad. Reenvía cualquier ruta bajo
 * sysacadws/{...} agregando el header Basic guardado en la cookie httpOnly.
 * Evita CORS y mantiene oculta la credencial del alumno.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const route = (path ?? []).join("/");

  // ── Guest mode: return mock sysacad data ──────────────────────────────────
  if (isGuestRequest(req)) {
    if (route.startsWith("cursado/datospersonales/"))       return NextResponse.json(MOCK_DATOS_PERSONALES);
    if (route.startsWith("cursado/coninasistencia/"))       return NextResponse.json(MOCK_CURSADO);
    if (route.startsWith("cursado/estadoacademico/"))       return NextResponse.json(MOCK_ESTADO_ACADEMICO);
    if (route.startsWith("cursado/materias/cantidadesporanio/")) return NextResponse.json(MOCK_AVANCE);
    if (route.startsWith("cursado/inasistencias/"))         return NextResponse.json(MOCK_INASISTENCIAS);
    if (route.startsWith("cursado/correlatividadcursado/")) return NextResponse.json(MOCK_CORRELATIVIDADES);
    if (route.startsWith("examenes/"))                      return NextResponse.json(MOCK_EXAMENES);
    if (route.startsWith("plan/"))                          return NextResponse.json(MOCK_PLAN);
    return NextResponse.json({ Estado: "OK", data: [] });
  }

  const auth = req.cookies.get("sysacadws_auth")?.value;
  if (!auth) {
    return NextResponse.json({ error: "No autenticado en Sysacad." }, { status: 401 });
  }
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
