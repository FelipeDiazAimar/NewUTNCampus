/**
 * Agregación de `login_events` — puro, sin I/O, sin dependencias, para poder
 * probarlo con `node` standalone y para que lo compartan las dos rutas admin
 * (login-stats y login-events) sin duplicar la lógica de fechas.
 *
 * Todo lo que toca fechas usa hora Argentina (UTC-3 fijo, sin horario de
 * verano desde 2009), no UTC del servidor, para que "hoy" coincida con el
 * reloj de pared del admin.
 */

export type LoginSource = "moodle" | "guest";
export type Granularity = "day" | "month";

export interface LoginEventRow {
  user_key: string;
  fullname: string | null;
  source: LoginSource;
  created_at: string; // ISO
}

export interface SeriesPoint {
  period: string; // "YYYY-MM-DD" (day) o "YYYY-MM" (month)
  distinctUsers: number;
}

export interface UserSummary {
  userKey: string;
  fullname: string | null;
  loginCount: number;
  lastLoginAt: string; // ISO
}

const AR_OFFSET = "-03:00";

// ─── Fecha (hora Argentina) ────────────────────────────────────────────────

function toArgentinaYMD(iso: string): { y: number; m: number; d: number } {
  const t = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function ymdInArgentina(d: Date): string {
  const p = toArgentinaYMD(d.toISOString());
  return ymd(p.y, p.m, p.d);
}

/** Clave de período ("YYYY-MM-DD" o "YYYY-MM") de un timestamp, en hora Argentina. */
export function periodKey(iso: string, granularity: Granularity): string {
  const { y, m, d } = toArgentinaYMD(iso);
  return granularity === "day" ? ymd(y, m, d) : `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * Resuelve [fromISO, toISO] a partir de query params "YYYY-MM-DD" (o null).
 * Sin params: últimos 30 días (day) o últimos 12 meses (month), hasta hoy.
 * Los límites quedan anclados a medianoche/fin de día en hora Argentina para
 * coincidir con los períodos que arma `periodKey`.
 */
export function resolveDateRange(
  fromParam: string | null,
  toParam: string | null,
  granularity: Granularity
): { fromISO: string; toISO: string } {
  const now = new Date();
  const toDefault = ymdInArgentina(now);
  const fromDefaultDate = new Date(now);
  if (granularity === "day") fromDefaultDate.setUTCDate(fromDefaultDate.getUTCDate() - 29);
  else fromDefaultDate.setUTCMonth(fromDefaultDate.getUTCMonth() - 11);
  const fromDefault = ymdInArgentina(fromDefaultDate);

  const from = fromParam || fromDefault;
  const to = toParam || toDefault;
  return {
    fromISO: `${from}T00:00:00.000${AR_OFFSET}`,
    toISO: `${to}T23:59:59.999${AR_OFFSET}`,
  };
}

/** Rango [fromISO, toISO] del día de hoy, en hora Argentina. */
export function argentinaTodayRangeISO(): { fromISO: string; toISO: string } {
  const today = ymdInArgentina(new Date());
  return { fromISO: `${today}T00:00:00.000${AR_OFFSET}`, toISO: `${today}T23:59:59.999${AR_OFFSET}` };
}

// ─── Agregación ─────────────────────────────────────────────────────────────

export function enumeratePeriods(fromISO: string, toISO: string, granularity: Granularity): string[] {
  const from = toArgentinaYMD(fromISO);
  const to = toArgentinaYMD(toISO);
  const periods: string[] = [];

  if (granularity === "day") {
    const cursor = new Date(Date.UTC(from.y, from.m - 1, from.d));
    const end = new Date(Date.UTC(to.y, to.m - 1, to.d));
    while (cursor.getTime() <= end.getTime()) {
      periods.push(ymd(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate()));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } else {
    let y = from.y;
    let m = from.m;
    while (y < to.y || (y === to.y && m <= to.m)) {
      periods.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  return periods;
}

/** Serie de personas distintas por período, incluyendo períodos en 0. */
export function buildSeries(
  rows: LoginEventRow[],
  granularity: Granularity,
  fromISO: string,
  toISO: string
): SeriesPoint[] {
  const periods = enumeratePeriods(fromISO, toISO, granularity);
  const usersByPeriod = new Map<string, Set<string>>();
  for (const p of periods) usersByPeriod.set(p, new Set());

  for (const row of rows) {
    const key = periodKey(row.created_at, granularity);
    usersByPeriod.get(key)?.add(row.user_key);
  }

  return periods.map((period) => ({ period, distinctUsers: usersByPeriod.get(period)!.size }));
}

/** Cantidad de user_key distintos entre las filas dadas. */
export function countDistinctUsers(rows: LoginEventRow[]): number {
  return new Set(rows.map((r) => r.user_key)).size;
}

/** Personas distintas (no el log crudo) agregadas de las filas, filtradas por q. */
export function buildUserSummaries(rows: LoginEventRow[], q?: string): UserSummary[] {
  const map = new Map<string, UserSummary>();
  for (const row of rows) {
    const existing = map.get(row.user_key);
    if (existing) {
      existing.loginCount += 1;
      if (row.created_at > existing.lastLoginAt) existing.lastLoginAt = row.created_at;
      if (!existing.fullname && row.fullname) existing.fullname = row.fullname;
    } else {
      map.set(row.user_key, {
        userKey: row.user_key,
        fullname: row.fullname,
        loginCount: 1,
        lastLoginAt: row.created_at,
      });
    }
  }

  let list = Array.from(map.values());
  if (q && q.trim()) {
    const needle = q.trim().toLowerCase();
    list = list.filter(
      (u) => u.userKey.toLowerCase().includes(needle) || (u.fullname ?? "").toLowerCase().includes(needle)
    );
  }
  return list.sort((a, b) => (a.lastLoginAt < b.lastLoginAt ? 1 : -1));
}
