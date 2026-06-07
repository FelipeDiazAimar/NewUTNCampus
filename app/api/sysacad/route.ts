import { NextRequest, NextResponse } from "next/server";
import { sysacadLogin } from "@/lib/sysacad";
import { sessionCookieOptions } from "@/lib/cookies";
import { encryptCred } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const { facultad, legajo, password, remember } = await req.json();

  if (!facultad || !legajo || !password) {
    return NextResponse.json({ error: "Campos requeridos" }, { status: 400 });
  }

  const keep = remember === true;

  console.log("[sysacad-api] Login attempt:", { facultad, legajo });
  try {
    const session = await sysacadLogin(Number(facultad), String(legajo), String(password));
    console.log("[sysacad-api] Login successful:", { legajo: session.legajo, alumno: session.alumno });

    const response = NextResponse.json({
      ok: true,
      alumno: session.alumno,
      legajo: session.legajo,
      facultad: session.facultad,
      menu: session.menu,
    });

    // httpOnly: session cookie + base URL, replayed server-side for future calls.
    response.cookies.set(
      "sysacad_session",
      JSON.stringify({ cookie: session.cookie, baseUrl: session.baseUrl }),
      sessionCookieOptions(keep, true)
    );

    // client-readable: name/legajo to gate the UI, mirrors `moodle_user`.
    response.cookies.set(
      "sysacad_user",
      JSON.stringify({
        legajo: session.legajo,
        alumno: session.alumno,
        facultad: session.facultad,
      }),
      sessionCookieOptions(keep, false)
    );
    // "Mantener sesión": credenciales cifradas para re-login automático al vencer el ASP.
    if (keep) {
      response.cookies.set(
        "sysacad_cred",
        encryptCred(JSON.stringify({ facultad: Number(facultad), legajo: String(legajo), password: String(password) })),
        sessionCookieOptions(true, true)
      );
    } else {
      response.cookies.delete("sysacad_cred");
    }
    return response;
  } catch (err) {
    console.error("[sysacad-api] Login error:", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("sysacad_session");
  response.cookies.delete("sysacad_user");
  response.cookies.delete("sysacad_cred");
  return response;
}
