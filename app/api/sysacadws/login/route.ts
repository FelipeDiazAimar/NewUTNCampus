import { NextRequest, NextResponse } from "next/server";
import { SYSACADWS_BASE, type SysacadDatosPersonales, type SysacadWsUser } from "@/lib/sysacadws";
import { sessionCookieOptions } from "@/lib/cookies";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { legajo, dni, remember } = await req.json().catch(() => ({}));
  if (!legajo || !dni) {
    return NextResponse.json({ error: "Completá legajo y contraseña." }, { status: 400 });
  }

  const keep = remember === true;

  const auth = Buffer.from(`${legajo}:${dni}`).toString("base64");

  // Validamos las credenciales pidiendo los datos personales.
  let perfil: SysacadDatosPersonales;
  try {
    const res = await fetch(`${SYSACADWS_BASE}/cursado/datospersonales/${encodeURIComponent(String(legajo))}`, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });
    if (!res.ok) {
      // El WS devuelve 404 cuando legajo:DNI no coinciden.
      return NextResponse.json({ error: "Legajo o contraseña incorrectos." }, { status: 401 });
    }
    perfil = (await res.json()) as SysacadDatosPersonales;
    if (!perfil?.NombreAlumno) {
      return NextResponse.json({ error: "Legajo o contraseña incorrectos." }, { status: 401 });
    }
  } catch (err) {
    console.error("[sysacadws-login]", (err as Error).message);
    return NextResponse.json({ error: "No se pudo conectar con Sysacad." }, { status: 502 });
  }

  const user: SysacadWsUser = {
    legajo: perfil.Legajo,
    nombre: perfil.NombreAlumno,
    especialidad: perfil.NombreEspecialidad,
    estado: perfil.EstadoAlumno,
    idEspecialidad: perfil.IdEspecialidad,
    plan: perfil.Plan,
  };

  const response = NextResponse.json({ ok: true, perfil });
  // Credencial Basic — httpOnly, nunca llega al cliente. La credencial de Sysacad
  // (legajo:DNI) no expira, así que solo depende de la persistencia de la cookie.
  response.cookies.set("sysacadws_auth", auth, sessionCookieOptions(keep, true));
  // Datos legibles para gatear la UI.
  response.cookies.set("sysacadws_user", JSON.stringify(user), sessionCookieOptions(keep, false));

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("sysacadws_auth");
  response.cookies.delete("sysacadws_user");
  // Limpiamos también las cookies del viejo scraping (usuarios pre-migración).
  response.cookies.delete("sysacad_session");
  response.cookies.delete("sysacad_user");
  response.cookies.delete("sysacad_cred");
  return response;
}
