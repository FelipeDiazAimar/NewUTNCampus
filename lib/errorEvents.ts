import { supabaseFetch } from "@/lib/supabase";

export type {
  Severity,
  Source,
  ConsoleEntry,
  ErrorEventRow,
  Granularity,
  SeverityCounts,
  SeveritySeriesPoint,
} from "@/lib/errorEventStats";
export {
  periodKey,
  resolveDateRange,
  argentinaTodayRangeISO,
  buildSeverityStats,
  buildSeveritySeries,
} from "@/lib/errorEventStats";

import type { ConsoleEntry, ErrorEventRow, Severity, Source } from "@/lib/errorEventStats";

/**
 * Registro de errores de toda la app (Supabase: `error_events`), append-only.
 * Best-effort, igual que `lib/loginEvents.ts`: si la tabla no existe o
 * Supabase no responde, degrada en silencio para no romper el flujo que
 * originó el error.
 */

const TABLE = "error_events";

/** Registra un error. Nunca lanza. */
export async function logErrorEvent(params: {
  severity: Severity;
  source: Source;
  message: string;
  stack?: string | null;
  section?: string | null;
  consoleLog?: ConsoleEntry[] | null;
  requestInfo?: Record<string, unknown> | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await supabaseFetch(TABLE, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        severity: params.severity,
        source: params.source,
        message: params.message,
        stack: params.stack ?? null,
        section: params.section ?? null,
        console_log: params.consoleLog ?? null,
        request_info: params.requestInfo ?? null,
        user_agent: params.userAgent ?? null,
      }),
    });
  } catch {
    /* best-effort */
  }
}

/** Filas con created_at en [fromISO, toISO], más recientes primero. Devuelve [] si Supabase falla. */
export async function fetchErrorEventsInRange(fromISO: string, toISO: string): Promise<ErrorEventRow[]> {
  try {
    const res = await supabaseFetch(
      `${TABLE}?created_at=gte.${encodeURIComponent(fromISO)}&created_at=lte.${encodeURIComponent(toISO)}&select=id,severity,source,message,stack,section,console_log,request_info,user_agent,created_at&order=created_at.desc`
    );
    if (!res.ok) return [];
    return (await res.json()) as ErrorEventRow[];
  } catch {
    return [];
  }
}
