import { NextRequest, NextResponse } from "next/server";
import { isGuestRequest } from "@/lib/guest";
import { sessionCookieOptions } from "@/lib/cookies";
import { ensureSession, getStatus, marcar, verificarIp } from "@/lib/asistenciaLegacy";

export const runtime = "nodejs";

const SESSION_COOKIE = "asistencia_legacy_cookie";

function getCredenciales(req: NextRequest): { legajo: string; dni: string } | null {
  const auth = req.cookies.get("sysacadws_auth")?.value;
  if (!auth) return null;
  const [legajo, dni] = Buffer.from(auth, "base64").toString("utf8").split(":");
  if (!legajo || !dni) return null;
  return { legajo, dni };
}

// Marca asistencia. El body trae `ip` (detectada por el propio navegador del
// alumno contra api.ipify.org) e `idMateria` — la materia se re-busca en un
// <select> recién traído del servidor de la facultad (nunca se confía en los
// datos de anio/especialidad/plan/comisión que mande el cliente), así una
// request manipulada no puede registrar una materia distinta a las realmente
// habilitadas en este momento.
export async function POST(req: NextRequest) {
  if (isGuestRequest(req)) {
    return NextResponse.json({ error: "No disponible en modo invitado." }, { status: 403 });
  }

  const cred = getCredenciales(req);
  if (!cred) return NextResponse.json({ error: "No autenticado en Sysacad." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ip = typeof body?.ip === "string" ? body.ip.trim() : "";
  const idMateria = typeof body?.idMateria === "string" ? body.idMateria : "";
  if (!ip || !idMateria) {
    return NextResponse.json({ error: "Faltan datos (ip / materia)." }, { status: 400 });
  }

  const existing = req.cookies.get(SESSION_COOKIE)?.value;
  const cookie = await ensureSession(existing, cred.legajo, cred.dni);
  if (!cookie) {
    return NextResponse.json(
      { error: "No se pudo iniciar sesión en el sistema de asistencias." },
      { status: 502 }
    );
  }

  const setCookie = (res: NextResponse) => {
    res.cookies.set(SESSION_COOKIE, cookie, sessionCookieOptions(true, true));
    return res;
  };

  const permitido = await verificarIp(cookie, ip);
  if (!permitido) {
    return setCookie(
      NextResponse.json(
        { error: "No estás conectado a la red de la facultad — la asistencia solo se puede marcar desde ahí." },
        { status: 403 }
      )
    );
  }

  const antes = await getStatus(cookie);
  const materia = antes.materias.find((m) => m.id === idMateria);
  if (!materia) {
    return setCookie(
      NextResponse.json({ error: "Esa materia ya no está disponible para marcar asistencia." }, { status: 400 })
    );
  }
  if (!materia.habilitada) {
    return setCookie(
      NextResponse.json({ error: "El docente todavía no habilitó la asistencia para esta materia." }, { status: 400 })
    );
  }

  const yaEstaba = antes.registradasHoy.some((r) => r.materia.trim().toLowerCase() === materia.nombre.trim().toLowerCase());
  const despues = await marcar(cookie, materia);
  const ok = despues.registradasHoy.some((r) => r.materia.trim().toLowerCase() === materia.nombre.trim().toLowerCase());

  return setCookie(
    NextResponse.json({
      ok,
      yaEstaba,
      materia: materia.nombre,
      materias: despues.materias,
      registradasHoy: despues.registradasHoy,
    })
  );
}
