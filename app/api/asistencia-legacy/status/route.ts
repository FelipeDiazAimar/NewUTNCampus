import { NextRequest, NextResponse } from "next/server";
import { isGuestRequest } from "@/lib/guest";
import { sessionCookieOptions } from "@/lib/cookies";
import { getStatus, packSessionForStorage, withDeviceFingerprint } from "@/lib/asistenciaLegacy";
import { resolverSesionLegacy } from "@/lib/asistenciaLegacySesiones";

export const runtime = "nodejs";

const SESSION_COOKIE = "asistencia_legacy_cookie";

/** legajo + DNI desde la credencial de Sysacad ya guardada (mismo esquema de login). */
function getCredenciales(req: NextRequest): { legajo: string; dni: string } | null {
  const auth = req.cookies.get("sysacadws_auth")?.value;
  if (!auth) return null;
  const [legajo, dni] = Buffer.from(auth, "base64").toString("utf8").split(":");
  if (!legajo || !dni) return null;
  return { legajo, dni };
}

// Trae las materias habilitadas para marcar asistencia AHORA (ya resuelto por
// el servidor de la facultad) + lo que ya se marcó hoy. No disponible en modo
// invitado: requiere una cuenta y una sesión real del sistema viejo.
export async function GET(req: NextRequest) {
  if (isGuestRequest(req)) {
    return NextResponse.json({ error: "No disponible en modo invitado." }, { status: 403 });
  }

  const cred = getCredenciales(req);
  if (!cred) return NextResponse.json({ error: "No autenticado en Sysacad." }, { status: 401 });

  const existing = req.cookies.get(SESSION_COOKIE)?.value;
  const deviceFingerprint = req.cookies.get("deviceFingerprint")?.value;
  const cookie = await resolverSesionLegacy({
    existingRaw: existing,
    legajo: cred.legajo,
    dni: cred.dni,
    deviceFingerprint,
  });
  if (!cookie) {
    return NextResponse.json(
      { error: "No se pudo iniciar sesión en el sistema de asistencias." },
      { status: 502 }
    );
  }

  const page = await getStatus(withDeviceFingerprint(cookie, deviceFingerprint));
  const res = NextResponse.json({ materias: page.materias, registradasHoy: page.registradasHoy });
  res.cookies.set(SESSION_COOKIE, packSessionForStorage(cred.legajo, cookie), sessionCookieOptions(true, true));
  return res;
}
