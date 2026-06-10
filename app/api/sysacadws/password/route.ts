import { NextRequest, NextResponse } from "next/server";
import { SYSACADWS_BASE, type SysacadDatosPersonales } from "@/lib/sysacadws";
import { sessionCookieOptions } from "@/lib/cookies";

export const runtime = "nodejs";

/**
 * Cambio de contraseña vía web service (reemplaza el scraping del form ASP):
 *   PUT /ingreso/cambiarcontrasenia/{legajo}/{dni}
 *   Authorization: Basic base64(legajo:passwordActual:passwordNueva)
 * El DNI (que pide la URL) se obtiene de /cursado/datospersonales con la
 * credencial actual, que de paso valida que la contraseña actual sea correcta.
 */
export async function POST(req: NextRequest) {
  const authCookie = req.cookies.get("sysacadws_auth")?.value;
  if (!authCookie) {
    return NextResponse.json({ error: "No autenticado en Sysacad." }, { status: 401 });
  }

  const { actual, nueva, repetir } = await req.json().catch(() => ({}));
  if (!actual || !nueva || !repetir) {
    return NextResponse.json({ error: "Completá todos los campos." }, { status: 400 });
  }
  if (nueva !== repetir) {
    return NextResponse.json({ error: "La nueva contraseña no coincide." }, { status: 400 });
  }

  // El legajo sale de la credencial guardada (base64 "legajo:password…").
  const legajo = Buffer.from(authCookie, "base64").toString("utf8").split(":")[0];
  if (!legajo) {
    return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
  }

  const currentAuth = Buffer.from(`${legajo}:${actual}`).toString("base64");

  try {
    // 1. Datos personales con la credencial actual → DNI + valida la contraseña.
    const dpRes = await fetch(
      `${SYSACADWS_BASE}/cursado/datospersonales/${encodeURIComponent(legajo)}`,
      { headers: { Authorization: `Basic ${currentAuth}` }, cache: "no-store" }
    );
    if (dpRes.status === 401 || dpRes.status === 404) {
      return NextResponse.json({ error: "La contraseña actual es incorrecta." }, { status: 400 });
    }
    if (!dpRes.ok) throw new Error("No se pudo validar la contraseña actual.");
    const dp = (await dpRes.json()) as SysacadDatosPersonales;
    const dni = dp.NumeroDocumento;
    if (!dni) throw new Error("No se pudo obtener el documento del alumno.");

    // 2. PUT del cambio: Basic base64(legajo:actual:nueva).
    const changeAuth = Buffer.from(`${legajo}:${actual}:${nueva}`).toString("base64");
    const putRes = await fetch(
      `${SYSACADWS_BASE}/ingreso/cambiarcontrasenia/${encodeURIComponent(legajo)}/${encodeURIComponent(dni)}`,
      { method: "PUT", headers: { Authorization: `Basic ${changeAuth}` }, cache: "no-store" }
    );
    const json = (await putRes.json().catch(() => ({}))) as { Estado?: string; Message?: string };
    const estado = (json.Estado ?? "").trim();
    // Éxito: 200 + Estado que arranca en "2" ("2 - Contraseña creada exitosamente…").
    if (!putRes.ok || !estado.startsWith("2")) {
      const raw = json.Message ?? (estado || "No se pudo cambiar la contraseña.");
      return NextResponse.json(
        { error: raw.replace(/^\s*\d+\s*-?\s*/, "").trim() || "No se pudo cambiar la contraseña." },
        { status: 400 }
      );
    }

    // 3. La credencial actual ya no sirve: guardamos la nueva (httpOnly, persistente).
    const newAuth = Buffer.from(`${legajo}:${nueva}`).toString("base64");
    const res = NextResponse.json({ ok: true, mensaje: "Contraseña actualizada." });
    res.cookies.set("sysacadws_auth", newAuth, sessionCookieOptions(true, true));
    return res;
  } catch (err) {
    console.error("[sysacadws-password]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
