import { NextRequest, NextResponse } from "next/server";
import { type SysacadAuth, sysacadFetch, sysacadLogin } from "@/lib/sysacad";
import { decryptCred } from "@/lib/crypto";
import { sessionCookieOptions } from "@/lib/cookies";

export const runtime = "nodejs";

/**
 * Keep-alive + validación de la sesión de Sysacad (scraping, ASP). Desliza el
 * timeout pidiendo menuAlumno.asp; si murió y hay credenciales guardadas
 * ("Mantener sesión"), re-loguea solo y renueva las cookies.
 */
export async function GET(req: NextRequest) {
  const raw = req.cookies.get("sysacad_session")?.value;

  // 1) Intentar deslizar la sesión actual.
  if (raw) {
    try {
      const auth = JSON.parse(raw) as SysacadAuth;
      await sysacadFetch(auth, "menuAlumno.asp"); // 302 si expiró → throw
      return NextResponse.json({ ok: true });
    } catch {
      /* expiró → probamos re-login abajo */
    }
  }

  // 2) Re-login automático con credenciales cifradas.
  const cred = req.cookies.get("sysacad_cred")?.value;
  if (cred) {
    const data = JSON.parse(decryptCred(cred) ?? "{}");
    if (data.legajo && data.password) {
      try {
        const session = await sysacadLogin(Number(data.facultad) || 12, String(data.legajo), String(data.password));
        const response = NextResponse.json({ ok: true, relogged: true });
        response.cookies.set(
          "sysacad_session",
          JSON.stringify({ cookie: session.cookie, baseUrl: session.baseUrl }),
          sessionCookieOptions(true, true)
        );
        response.cookies.set(
          "sysacad_user",
          JSON.stringify({ legajo: session.legajo, alumno: session.alumno, facultad: session.facultad }),
          sessionCookieOptions(true, false)
        );
        response.cookies.set("sysacad_cred", cred, sessionCookieOptions(true, true));
        console.log("[sysacad-ping] re-login automático OK");
        return response;
      } catch (err) {
        console.log("[sysacad-ping] re-login automático falló:", (err as Error).message);
      }
    }
  }

  return NextResponse.json({ error: "Sesión expirada" }, { status: 401 });
}
