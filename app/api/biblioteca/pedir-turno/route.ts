// Alta de turno en el legacy de la biblioteca.
// Recibe los datos del formulario de /biblioteca + el token de captcha
// resuelto vía /api/captcha, y ejecuta el flujo probado contra el legacy
// (warm-up + POST multipart, ver BIBLIOTECA_CAPTCHA_REMOTO.md §8).

import { NextRequest, NextResponse } from "next/server";
import { pedirTurno, type DatosTurno } from "@/lib/turnosLegacy";
import { isGuestRequest } from "@/lib/guest";

export const runtime = "nodejs";
export const maxDuration = 60;

const FECHA_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const ID_RE = /^\d{1,6}$/;

function str(v: unknown, max = 120): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(req: NextRequest) {
  if (isGuestRequest(req)) {
    return NextResponse.json({ ok: false, mensaje: "Iniciá sesión para pedir turnos." }, { status: 401 });
  }
  // Requiere sesión de la app (igual que la página de biblioteca).
  const cookie = req.headers.get("cookie") || "";
  if (!/moodle_user=|sysacadws_auth=/.test(cookie)) {
    return NextResponse.json({ ok: false, mensaje: "Iniciá sesión para pedir turnos." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, mensaje: "Body inválido." }, { status: 400 });
  }

  const token = str(body.captchaToken, 4096);
  const fecha = str(body.fecha, 10);
  const datos: DatosTurno = {
    responsable: str(body.responsable, 6),
    areaDesc: str(body.areaDesc, 100),
    tematica: str(body.tematica, 6),
    tematicaDesc: str(body.tematicaDesc, 100),
    fecha,
    idHorario: str(body.idHorario, 6),
    horarioDesc: str(body.horarioDesc, 10),
    tipoDocumento: str(body.tipoDocumento, 10) || "DNI",
    nroDocumento: str(body.nroDocumento, 12),
    nombre: str(body.nombre, 60),
    apellido: str(body.apellido, 60),
    email: str(body.email, 100),
    telefono: str(body.telefono, 25),
    localidad: str(body.localidad, 80),
    provincia: str(body.provincia, 60),
  };

  const faltantes: string[] = [];
  if (!ID_RE.test(datos.responsable)) faltantes.push("área");
  if (!ID_RE.test(datos.tematica)) faltantes.push("temática");
  if (!FECHA_RE.test(fecha)) faltantes.push("fecha (formato dd/MM/yyyy)");
  if (!ID_RE.test(datos.idHorario)) faltantes.push("horario");
  if (!datos.horarioDesc) faltantes.push("descripción de horario");
  if (!datos.nroDocumento) faltantes.push("DNI");
  if (!datos.nombre) faltantes.push("nombre");
  if (!datos.apellido) faltantes.push("apellido");
  if (!/.+@.+\..+/.test(datos.email)) faltantes.push("email");
  if (faltantes.length) {
    return NextResponse.json(
      { ok: false, mensaje: `Datos incompletos o inválidos: ${faltantes.join(", ")}.` },
      { status: 400 }
    );
  }

  try {
    const r = await pedirTurno(datos, token);
    return NextResponse.json(
      { ok: r.ok, veredicto: r.veredicto, mensaje: r.mensaje, fechaHora: r.fechaHora },
      { status: r.ok ? 200 : 422 }
    );
  } catch (e) {
    console.error("[pedir-turno] error:", e);
    return NextResponse.json(
      { ok: false, mensaje: "Error de red contactando el sistema de turnos." },
      { status: 502 }
    );
  }
}
