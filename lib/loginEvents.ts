import { supabaseFetch } from "@/lib/supabase";

export type {
  LoginSource,
  Granularity,
  LoginEventRow,
  SeriesPoint,
  UserSummary,
} from "@/lib/loginEventStats";
export {
  periodKey,
  resolveDateRange,
  argentinaTodayRangeISO,
  buildSeries,
  countDistinctUsers,
  buildUserSummaries,
} from "@/lib/loginEventStats";

import type { LoginEventRow, LoginSource } from "@/lib/loginEventStats";

/**
 * Historial de inicios de sesión (Supabase: `login_events`), append-only.
 * A diferencia de `device_sessions` (una fila por dispositivo, se
 * sobreescribe), acá se guarda una fila POR LOGIN, para poder reconstruir
 * cuántas personas distintas entraron un día u mes dado.
 *
 * Todo es best-effort, igual que `lib/deviceSessions.ts`: si la tabla no
 * existe o Supabase no responde, las funciones degradan en silencio para no
 * romper el login ni el dashboard.
 */

const TABLE = "login_events";

/** Registra un login. Nunca lanza. */
export async function logLoginEvent(params: {
  userKey: string;
  fullname?: string | null;
  source: LoginSource;
}): Promise<void> {
  try {
    await supabaseFetch(TABLE, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        user_key: params.userKey,
        fullname: params.fullname ?? null,
        source: params.source,
      }),
    });
  } catch {
    /* best-effort */
  }
}

/** Filas con created_at en [fromISO, toISO]. Devuelve [] si Supabase falla. */
export async function fetchLoginEventsInRange(fromISO: string, toISO: string): Promise<LoginEventRow[]> {
  try {
    const res = await supabaseFetch(
      `${TABLE}?created_at=gte.${encodeURIComponent(fromISO)}&created_at=lte.${encodeURIComponent(toISO)}&select=user_key,fullname,source,created_at&order=created_at.desc`
    );
    if (!res.ok) return [];
    return (await res.json()) as LoginEventRow[];
  } catch {
    return [];
  }
}
