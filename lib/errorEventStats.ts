/**
 * Agregación de `error_events` — puro, sin I/O, para poder probarlo con
 * `node` standalone. Reusa la lógica de fechas (hora Argentina) de
 * `lib/loginEventStats.ts` en vez de duplicarla.
 */

export { periodKey, resolveDateRange, argentinaTodayRangeISO } from "@/lib/loginEventStats";
export type { Granularity } from "@/lib/loginEventStats";

import { periodKey, enumeratePeriods, type Granularity } from "@/lib/loginEventStats";

export type Severity = "critical" | "error" | "warning";
export type Source = "client" | "server";

export interface ConsoleEntry {
  level: string;
  args: string;
  at: string; // ISO
}

export interface ErrorEventRow {
  id: number;
  severity: Severity;
  source: Source;
  message: string;
  stack: string | null;
  section: string | null;
  console_log: ConsoleEntry[] | null;
  request_info: Record<string, unknown> | null;
  user_agent: string | null;
  created_at: string; // ISO
}

export interface SeverityCounts {
  critical: number;
  error: number;
  warning: number;
}

export interface SeveritySeriesPoint extends SeverityCounts {
  period: string;
}

function emptyCounts(): SeverityCounts {
  return { critical: 0, error: 0, warning: 0 };
}

/** Cantidad de errores por severidad entre las filas dadas. */
export function buildSeverityStats(rows: ErrorEventRow[]): SeverityCounts {
  const counts = emptyCounts();
  for (const row of rows) counts[row.severity] += 1;
  return counts;
}

/** Serie de cantidad de errores por severidad y período, incluyendo períodos en 0. */
export function buildSeveritySeries(
  rows: ErrorEventRow[],
  granularity: Granularity,
  fromISO: string,
  toISO: string
): SeveritySeriesPoint[] {
  const periods = enumeratePeriods(fromISO, toISO, granularity);
  const countsByPeriod = new Map<string, SeverityCounts>();
  for (const p of periods) countsByPeriod.set(p, emptyCounts());

  for (const row of rows) {
    const key = periodKey(row.created_at, granularity);
    const counts = countsByPeriod.get(key);
    if (counts) counts[row.severity] += 1;
  }

  return periods.map((period) => ({ period, ...countsByPeriod.get(period)! }));
}
