import { NextRequest, NextResponse } from "next/server";
import { isGuestRequest } from "@/lib/guest";
import { sessionCookieOptions } from "@/lib/cookies";
import { ensureSession, getStatus, marcar, packSessionForStorage, verificarIp } from "@/lib/asistenciaLegacy";

// Configuramos el endpoint para ejecutarse en la red global de Vercel (Edge Runtime)
// Esto distribuye geográficamente las conexiones entrantes al sistema legacy.
export const runtime = "edge"; 

const SESSION_COOKIE = "asistencia_legacy_cookie";

// IP pública exacta del gateway de la facultad. El sistema legacy espera ESTA IP exacta.
const IP_FACULTAD_VALIDA = "190.16.182.88";

function getCredenciales(req: NextRequest): { legajo: string; dni: string } | null {
  const auth = req.cookies.get("sysacadws_auth")?.value;
  if (!auth) return null;
  
  try {
    // Reemplazamos Buffer por atob (Web API nativa compatible con Edge Runtime)
    const decoded = atob(auth);
    const [legajo, dni] = decoded.split(":");
    if (!legajo || !dni) return null;
    return { legajo, dni };
  } catch (e) {
    return null; // En caso de que el string no sea un Base64 válido
  }
}

// Marca asistencia forzando la IP pública única de la facultad.
export async function POST(req: NextRequest) {
  if (isGuestRequest(req)) {
    return NextResponse.json({ error: "No disponible en modo invitado." }, { status: 403 });
  }

  const cred = getCredenciales(req);
  if (!cred) return NextResponse.json({ error: "No autenticado en Sysacad." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const idMateria = typeof body?.idMateria === "string" ? body.idMateria : "";
  
  if (!idMateria) {
    return NextResponse.json({ error: "Faltan datos (materia)." }, { status: 400 });
  }

  // Forzamos estrictamente la IP pública única del establecimiento
  const ip = IP_FACULTAD_VALIDA;

  const existing = req.cookies.get(SESSION_COOKIE)?.value;
  const cookie = await ensureSession(existing, cred.legajo, cred.dni);
  if (!cookie) {
    return NextResponse.json(
      { error: "No se pudo iniciar sesión en el sistema de asistencias." },
      { status: 502 }
    );
  }

  const setCookie = (res: NextResponse) => {
    res.cookies.set(SESSION_COOKIE, packSessionForStorage(cred.legajo, cookie), sessionCookieOptions(true, true));
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
  const { page: despues, rechazo } = await marcar(cookie, materia);
  const ok = despues.registradasHoy.some((r) => r.materia.trim().toLowerCase() === materia.nombre.trim().toLowerCase());

  // El sistema legacy puede rechazar el marcado con un motivo explícito (p. ej.
  // su restricción anti-fraude de "un dispositivo, un legajo por día") sin que
  // eso sea un error nuestro — se lo mostramos al usuario tal cual.
  if (!ok && rechazo) {
    return setCookie(NextResponse.json({ error: rechazo }, { status: 409 }));
  }

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
