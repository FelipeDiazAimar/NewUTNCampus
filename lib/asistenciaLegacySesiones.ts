import { supabaseFetch } from "@/lib/supabase";
import { fetchApplyLeave, login, unpackSession } from "@/lib/asistenciaLegacy";

/**
 * Caché de sesiones del sistema legacy de asistencias (Supabase:
 * `asistencia_legacy_sesiones`). Ver scripts/asistencia-legacy-sesiones.sql.
 *
 * Hoy la cookie PHP del legacy vive solo en el navegador, empaquetada con el
 * legajo (`asistencia_legacy_cookie = legajo::PHPSESSID=...`). Eso significa
 * que si alguien cierra sesión y entra con otra cuenta en el mismo dispositivo,
 * la cookie de la cuenta anterior se pierde y hay que repetir el login completo
 * (2 requests + verificación) contra el legacy.
 *
 * Acá se persiste por legajo con un TTL heurístico de 20 horas. La alividad REAL
 * de la cookie siempre se verifica contra el legacy antes de reusarla — si ya
 * expiró (o el TTL es mentira), cae al login fresco y se sobrescribe la fila.
 *
 * Todo es best-effort: si Supabase no responde o la tabla no existe, el flujo
 * degrada a lo de siempre (cookie del navegador o login) sin romper nada.
 */

const TABLE = "asistencia_legacy_sesiones";

/** Vida útil heurística de una sesión del legacy. La real puede ser menor. */
export const SESSION_TTL_HOURS = 20;

type Row = {
  legajo: string;
  cookie: string;
  created_at: string;
  expires_at: string;
};

export async function getSesionVigente(legajo: string): Promise<string | null> {
  try {
    const res = await supabaseFetch(
      `${TABLE}?legajo=eq.${encodeURIComponent(legajo)}&select=cookie,expires_at`
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Pick<Row, "cookie" | "expires_at">[];
    const row = rows[0];
    if (!row?.cookie) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    return row.cookie;
  } catch {
    return null;
  }
}

export async function guardarSesion(legajo: string, cookie: string): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  try {
    await supabaseFetch(`${TABLE}?on_conflict=legajo`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        legajo,
        cookie,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      }),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Resuelve una cookie viva del legacy para `legajo` probando fuentes en orden
 * de costo:
 *
 *  1. Cookie del navegador de ESTE legajo → verificación real (idéntico a hoy).
 *  2. Fila vigente en Supabase           → misma verificación real.
 *  3. Login fresco                       → persiste la nueva cookie en la tabla.
 *
 * El valor devuelto es la cookie cruda lista para usar (sin empaquetar); para
 * mandarla al navegador usar `packSessionForStorage`.
 */
export async function resolverSesionLegacy(params: {
  existingRaw: string | undefined;
  legajo: string;
  dni: string;
  deviceFingerprint?: string;
}): Promise<string | null> {
  // 1. Cookie del navegador, solo si corresponde a este legajo.
  const browserCookie = unpackSession(params.existingRaw, params.legajo);
  if (browserCookie) {
    const { page } = await fetchApplyLeave(browserCookie, params.deviceFingerprint);
    if (page.autenticado) return browserCookie;
  }

  // 2. Caché en Supabase (mismo legajo desde otro dispositivo, o cookie vieja muerta).
  const dbCookie = await getSesionVigente(params.legajo);
  if (dbCookie && dbCookie !== browserCookie) {
    const { page } = await fetchApplyLeave(dbCookie, params.deviceFingerprint);
    if (page.autenticado) return dbCookie;
  }

  // 3. Login completo; la nueva cookie queda cacheada por legajo.
  const fresh = await login(params.legajo, params.dni, params.deviceFingerprint);
  if (fresh) await guardarSesion(params.legajo, fresh);
  return fresh;
}
