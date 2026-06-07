import { NextRequest, NextResponse } from "next/server";
import { moodleLogin, refreshMoodleSession, type MoodleSession } from "@/lib/moodle";
import { sessionCookieOptions } from "@/lib/cookies";
import { encryptCred, decryptCred } from "@/lib/crypto";

/** Guarda en la respuesta las cookies de una sesión de Moodle recién creada. */
function setSessionCookies(response: NextResponse, session: MoodleSession, keep: boolean) {
  response.cookies.set("moodle_session_token", session.cookie.replace("MoodleSession=", ""), sessionCookieOptions(keep, true));
  response.cookies.set("moodle_sesskey", session.sesskey, sessionCookieOptions(keep, true));
  response.cookies.set(
    "moodle_user",
    JSON.stringify({ userid: session.userid, fullname: session.fullname, username: session.username }),
    sessionCookieOptions(keep, false)
  );
  response.cookies.set("moodle_remember", keep ? "1" : "0", sessionCookieOptions(keep, false));
}

export async function POST(req: NextRequest) {
  const { username, password, remember } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Campos requeridos" }, { status: 400 });
  }

  const keep = remember === true;

  console.log("[auth] Login attempt for user:", username, keep ? "(remember)" : "");
  try {
    const session = await moodleLogin(username, password);
    console.log("[auth] Login successful:", { userid: session.userid, fullname: session.fullname });
    const response = NextResponse.json({ ok: true, session });
    setSessionCookies(response, session, keep);
    // "Mantener sesión": guardamos credenciales cifradas para re-loguear solo al vencer.
    if (keep) {
      response.cookies.set("moodle_cred", encryptCred(JSON.stringify({ u: username, p: password })), sessionCookieOptions(true, true));
    } else {
      response.cookies.delete("moodle_cred");
    }
    return response;
  } catch (err) {
    console.error("[auth] Login error:", (err as Error).message);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 401 }
    );
  }
}

// Keep-alive: renueva la sesión mientras el navegador siga abierto. Rota el token
// de Moodle si el servidor lo regeneró y desliza la expiración de las cookies.
export async function GET(req: NextRequest) {
  const token = req.cookies.get("moodle_session_token")?.value;
  const sesskey = req.cookies.get("moodle_sesskey")?.value;
  const cred = req.cookies.get("moodle_cred")?.value;
  const keep = req.cookies.get("moodle_remember")?.value === "1";

  // 1) Intentar deslizar la sesión actual.
  if (token && sesskey) {
    try {
      const r = await refreshMoodleSession(token);
      if (r.alive) {
        const response = NextResponse.json({ ok: true });
        response.cookies.set("moodle_session_token", r.token, sessionCookieOptions(keep, true));
        response.cookies.set("moodle_sesskey", sesskey, sessionCookieOptions(keep, true));
        const user = req.cookies.get("moodle_user")?.value;
        if (user) response.cookies.set("moodle_user", user, sessionCookieOptions(keep, false));
        response.cookies.set("moodle_remember", keep ? "1" : "0", sessionCookieOptions(keep, false));
        return response;
      }
    } catch {
      // Error de red: no matamos la sesión, devolvemos ok para no alarmar.
      return NextResponse.json({ ok: true, stale: true });
    }
  }

  // 2) Sesión muerta (o sin token): si guardamos credenciales, re-logueamos solo.
  if (cred) {
    const data = JSON.parse(decryptCred(cred) ?? "{}");
    if (data.u && data.p) {
      try {
        const session = await moodleLogin(data.u, data.p);
        const response = NextResponse.json({ ok: true, relogged: true });
        setSessionCookies(response, session, true);
        response.cookies.set("moodle_cred", cred, sessionCookieOptions(true, true));
        console.log("[auth] re-login automático OK");
        return response;
      } catch (err) {
        console.log("[auth] re-login automático falló:", (err as Error).message);
      }
    }
  }

  // 3) Sin forma de recuperar → cerrada.
  return NextResponse.json({ error: "Sesión expirada" }, { status: 401 });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("moodle_session_token");
  response.cookies.delete("moodle_sesskey");
  response.cookies.delete("moodle_user");
  response.cookies.delete("moodle_remember");
  response.cookies.delete("moodle_cred");
  return response;
}
