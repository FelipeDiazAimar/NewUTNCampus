# Métricas de inicios de sesión en /admin/dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Uso del Campus" section to `/admin/dashboard` showing how many **distinct** people logged in per day/month (toggle + date-range filter), plus a searchable modal listing every distinct person that logged in, backed by a new append-only `login_events` Supabase table.

**Architecture:** A new Supabase table `login_events` gets one row per real login (explicit Moodle username/password login, and guest-mode entry). Two new admin-only API routes read that table and hand back either a per-period distinct-user series or a searchable per-person summary; all aggregation happens in plain JS over rows fetched from Supabase (no SQL functions). The pure aggregation logic lives in a dependency-free `lib/loginEventStats.ts` so it can be exercised with a standalone `node` script; `lib/loginEvents.ts` wraps it with the actual Supabase I/O, mirroring the existing `lib/deviceSessions.ts` pattern. On the client, a new `LoginStatsSection` (bar chart + segmented control + date filter) and `LoginEventsModal` (search) are added to the existing `/admin/dashboard` page.

**Tech Stack:** Next.js App Router (Node runtime), TypeScript, Supabase REST (`lib/supabase.ts` → `supabaseFetch`, service-role key, no ORM), `recharts` (already a dependency), Tailwind CSS v4 iOS HIG styling (inline hex / `var(--…)` tokens).

## Global Constraints

- No test suite exists in this repo (stated in `CLAUDE.md`) — do not add one. Verify with `npx tsc --noEmit`, `npm run lint`, `npm run build`, standalone `node` checks for pure functions, and `curl` against the dev server.
- Colors are inline hex literals or `var(--…)` tokens in JSX, never Tailwind palette tokens (`bg-blue-500` etc.). Dark mode via the existing CSS variables (no extra `dark:` handling needed — the vars already flip).
- `@/*` maps to the project root.
- Only these events are logged as "ingreso": explicit login via `POST /api/auth` (Moodle username/password success) and guest entry via `GET /api/guest/login`. The `GET /api/auth` keep-alive/silent-relogin path and `GET /api/auth/google/callback` (Google Drive connection, not a Campus login) are never logged.
- Guest logins are recorded with `user_key = "invitado"`, `fullname = "Invitado"`, `source = "guest"` — guest mode cannot distinguish different people.
- All `login_events` I/O (write and read) is best-effort: Supabase failures or a missing table must never break login, the guest redirect, or the admin dashboard — routes return empty series/lists (HTTP 200) instead of erroring.
- New admin API routes (`/api/admin/login-stats`, `/api/admin/login-events`) must reject non-admin requests the same way existing code does: `isAdminRequest(req)` from `lib/adminAuth.ts`, returning `401` JSON on failure.
- Day/month bucketing and "today" use fixed Argentina time (UTC-3, no DST since 2009), not server UTC, so the admin's "today" matches their wall clock.
- Reuse `components/campus/SegmentedControl.tsx` for the Diario/Mensual toggle and `components/sysacadws/charts/common.tsx` (`useChartColors`, `ChartTooltip`) for the chart — don't reinvent either.

---

### Task 1: Create the `login_events` table in Supabase (manual)

**Files:** none (Supabase dashboard action — this repo has no migration tooling).

This is a manual precondition: log in to the project's Supabase dashboard → SQL editor, and run:

```sql
create table login_events (
  id bigserial primary key,
  user_key text not null,
  fullname text,
  source text not null check (source in ('moodle', 'guest')),
  created_at timestamptz not null default now()
);
create index login_events_created_at_idx on login_events (created_at);
```

- [ ] **Step 1: Run the SQL above against the project's Supabase database.**

- [ ] **Step 2: Confirm the table exists**

In the Supabase dashboard's Table Editor, confirm `login_events` appears with columns `id, user_key, fullname, source, created_at`. There's nothing to `curl` yet — end-to-end verification against this table happens in Task 6, once the write/read code exists.

No commit for this task (no files changed in the repo).

---

### Task 2: `lib/loginEventStats.ts` — pure types and aggregation

**Files:**
- Create: `lib/loginEventStats.ts`

**Interfaces:**
- Produces: `LoginSource`, `Granularity`, `LoginEventRow`, `SeriesPoint`, `UserSummary` types, and functions `periodKey`, `resolveDateRange`, `argentinaTodayRangeISO`, `buildSeries`, `countDistinctUsers`, `buildUserSummaries`. Consumed by Task 3 (re-exported), Task 4 (API routes).

- [ ] **Step 1: Write the file**

```ts
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

function enumeratePeriods(fromISO: string, toISO: string, granularity: Granularity): string[] {
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Nothing imports the file yet.

- [ ] **Step 3: Sanity-check the aggregation against real data shapes**

The file has zero imports, so it compiles standalone (same trick as `lib/campus.ts` in the automatrícula plan — don't assume `tsx`/`ts-node` are installed):

```bash
npx tsc lib/loginEventStats.ts --outDir /tmp/loginstatscheck --module commonjs --target es2020 --skipLibCheck
node -e '
const {
  periodKey, buildSeries, countDistinctUsers, buildUserSummaries, resolveDateRange, argentinaTodayRangeISO,
} = require("/tmp/loginstatscheck/loginEventStats.js");

let fallos = 0;
function check(desc, ok) {
  console.log(ok ? "OK  " : "FAIL", desc);
  if (!ok) fallos++;
}

// periodKey: 01:30 UTC on 2026-08-09 is 22:30 ART on 2026-08-08.
check("periodKey day crosses midnight AR", periodKey("2026-08-09T01:30:00.000Z", "day") === "2026-08-08");
check("periodKey month", periodKey("2026-08-09T01:30:00.000Z", "month") === "2026-08");

// buildSeries: two logins same AR-day by the same user count once; different user adds one.
const rows = [
  { user_key: "a@utn.edu.ar", fullname: "A", source: "moodle", created_at: "2026-08-01T13:00:00.000-03:00" },
  { user_key: "a@utn.edu.ar", fullname: "A", source: "moodle", created_at: "2026-08-01T18:00:00.000-03:00" },
  { user_key: "b@utn.edu.ar", fullname: "B", source: "moodle", created_at: "2026-08-01T20:00:00.000-03:00" },
  { user_key: "c@utn.edu.ar", fullname: "C", source: "moodle", created_at: "2026-08-03T10:00:00.000-03:00" },
];
const series = buildSeries(rows, "day", "2026-08-01T00:00:00.000-03:00", "2026-08-03T23:59:59.999-03:00");
check("series has 3 days incl. empty middle day", series.length === 3);
check("day 1 has 2 distinct users", series[0].period === "2026-08-01" && series[0].distinctUsers === 2);
check("day 2 (no logins) is 0", series[1].period === "2026-08-02" && series[1].distinctUsers === 0);
check("day 3 has 1 distinct user", series[2].period === "2026-08-03" && series[2].distinctUsers === 1);

check("countDistinctUsers", countDistinctUsers(rows) === 3);

const summaries = buildUserSummaries(rows);
const a = summaries.find((u) => u.userKey === "a@utn.edu.ar");
check("summary loginCount for repeated user", a && a.loginCount === 2);
check("summary lastLoginAt keeps the latest", a && a.lastLoginAt === "2026-08-01T18:00:00.000-03:00");
check("summary q filters by substring", buildUserSummaries(rows, "b@utn").length === 1);
check("summary q no match", buildUserSummaries(rows, "zzz").length === 0);

const range = resolveDateRange(null, null, "day");
check("resolveDateRange default day span is 30 days", range.fromISO.endsWith("-03:00") && range.toISO.endsWith("-03:00"));

const today = argentinaTodayRangeISO();
check("argentinaTodayRangeISO from < to", today.fromISO < today.toISO);

console.log(fallos === 0 ? "TODO OK" : fallos + " FALLOS");
'
```

Expected: every line prints `OK` and the last line is `TODO OK`. If a row fails, fix `lib/loginEventStats.ts` rather than loosening the check.

- [ ] **Step 4: Commit**

```bash
git add lib/loginEventStats.ts
git commit -m "feat(admin): add pure login-event aggregation helpers"
```

---

### Task 3: `lib/loginEvents.ts` — Supabase I/O

**Files:**
- Create: `lib/loginEvents.ts`

**Interfaces:**
- Consumes: everything from `lib/loginEventStats.ts` (Task 2), re-exports it.
- Produces: `logLoginEvent(params)`, `fetchLoginEventsInRange(fromISO, toISO)`. Consumed by Task 4 (API routes) and Task 5 (instrumentation).

- [ ] **Step 1: Write the file**

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Nothing imports the file yet.

- [ ] **Step 3: Commit**

```bash
git add lib/loginEvents.ts
git commit -m "feat(admin): add Supabase I/O for login_events"
```

---

### Task 4: Admin API routes — `login-stats` and `login-events`

**Files:**
- Create: `app/api/admin/login-stats/route.ts`
- Create: `app/api/admin/login-events/route.ts`

**Interfaces:**
- Consumes: `isAdminRequest` (`lib/adminAuth.ts`), everything from `lib/loginEvents.ts` (Task 3).
- Produces: `GET /api/admin/login-stats` → `{ series: SeriesPoint[]; todayDistinctUsers: number }`. `GET /api/admin/login-events` → `{ users: UserSummary[] }`. Consumed by Task 7 and Task 8 (UI).

- [ ] **Step 1: Write `app/api/admin/login-stats/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import {
  argentinaTodayRangeISO,
  buildSeries,
  countDistinctUsers,
  fetchLoginEventsInRange,
  resolveDateRange,
  type Granularity,
} from "@/lib/loginEvents";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const granularity: Granularity = req.nextUrl.searchParams.get("granularity") === "month" ? "month" : "day";
  const { fromISO, toISO } = resolveDateRange(
    req.nextUrl.searchParams.get("from"),
    req.nextUrl.searchParams.get("to"),
    granularity
  );

  const today = argentinaTodayRangeISO();
  const [rangeRows, todayRows] = await Promise.all([
    fetchLoginEventsInRange(fromISO, toISO),
    fetchLoginEventsInRange(today.fromISO, today.toISO),
  ]);

  return NextResponse.json({
    series: buildSeries(rangeRows, granularity, fromISO, toISO),
    todayDistinctUsers: countDistinctUsers(todayRows),
  });
}
```

- [ ] **Step 2: Write `app/api/admin/login-events/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { buildUserSummaries, fetchLoginEventsInRange, resolveDateRange } from "@/lib/loginEvents";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { fromISO, toISO } = resolveDateRange(
    req.nextUrl.searchParams.get("from"),
    req.nextUrl.searchParams.get("to"),
    "day"
  );
  const q = req.nextUrl.searchParams.get("q") ?? undefined;

  const rows = await fetchLoginEventsInRange(fromISO, toISO);
  return NextResponse.json({ users: buildUserSummaries(rows, q) });
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify the 401 without an admin session**

With the dev server running (`npm run dev` in another terminal):

```bash
curl -s -o /dev/null -w "login-stats=%{http_code}\n" "http://localhost:3000/api/admin/login-stats"
curl -s -o /dev/null -w "login-events=%{http_code}\n" "http://localhost:3000/api/admin/login-events"
```

Expected: `login-stats=401` and `login-events=401` (no `admin_session_token` cookie sent). Full authenticated verification (200 with real data) happens in Task 6, once events exist to read.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/login-stats/route.ts app/api/admin/login-events/route.ts
git commit -m "feat(admin): add login-stats and login-events API routes"
```

---

### Task 5: Instrument the two login paths

**Files:**
- Modify: `app/api/auth/route.ts`
- Modify: `app/api/guest/login/route.ts`

**Interfaces:**
- Consumes: `logLoginEvent` (Task 3).

- [ ] **Step 1: Log Moodle logins in `app/api/auth/route.ts`**

Add the import near the other `lib` imports (top of file):

```ts
import { logLoginEvent } from "@/lib/loginEvents";
```

In the `POST` handler, right after the existing `upsertDeviceSession` call (the block that already runs on successful login — around where `deviceId` is registered), add:

```ts
    await logLoginEvent({ userKey: session.username, fullname: session.fullname, source: "moodle" });
```

Place it directly below the existing `await upsertDeviceSession({...});` call, still inside the `try` block, before the `if (keep) { ... }` credential-saving block. Do not touch the `GET` (keep-alive) or `DELETE` (logout) handlers — only the `POST` success path logs an event.

- [ ] **Step 2: Log guest entries in `app/api/guest/login/route.ts`**

Add the import:

```ts
import { logLoginEvent } from "@/lib/loginEvents";
```

Right before the `return res;` at the end of the `GET` handler, add:

```ts
  await logLoginEvent({ userKey: "invitado", fullname: "Invitado", source: "guest" });

  return res;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/route.ts app/api/guest/login/route.ts
git commit -m "feat(admin): log login events on Moodle and guest login"
```

---

### Task 6: End-to-end verification with `curl`

**Files:** none (verification only).

- [ ] **Step 1: Trigger a guest login**

With the dev server running:

```bash
curl -s -o /dev/null -c /tmp/guest_cookies.txt -w "guest-login=%{http_code}\n" \
  "http://localhost:3000/api/guest/login"
```

Expected: `guest-login=200` (it's a redirect the browser follows; curl without `-L` still gets a 3xx/200 depending on Next's handling — either way the request reaches the route and `logLoginEvent` runs before the response is returned).

- [ ] **Step 2: Log in as admin and save the session cookie**

Read `ADMIN_USER`/`ADMIN_PASS` from `.env.local` (do not hardcode or print secrets in commit history — this is a local, throwaway verification):

```bash
curl -s -c /tmp/admin_cookies.txt -o /dev/null -w "admin-login=%{http_code}\n" \
  -X POST -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" \
  "http://localhost:3000/api/admin/login"
```

(Export `ADMIN_USER`/`ADMIN_PASS` in the shell first, reading them from `.env.local`, if they aren't already in the environment.)

Expected: `admin-login=200`.

- [ ] **Step 3: Confirm today's distinct-user count reflects the guest login**

```bash
curl -s -b /tmp/admin_cookies.txt "http://localhost:3000/api/admin/login-stats?granularity=day" | head -c 500
```

Expected: JSON with `"todayDistinctUsers"` ≥ 1, and a `series` array whose last entry (today's period) has `distinctUsers` ≥ 1.

- [ ] **Step 4: Confirm the guest shows up in login-events**

```bash
curl -s -b /tmp/admin_cookies.txt "http://localhost:3000/api/admin/login-events?q=invitado" | head -c 500
```

Expected: JSON with a `users` array containing one entry with `"userKey":"invitado"` and `loginCount` ≥ 1.

- [ ] **Step 5: Confirm the search filter excludes non-matches**

```bash
curl -s -b /tmp/admin_cookies.txt "http://localhost:3000/api/admin/login-events?q=zzz-no-such-user" | head -c 200
```

Expected: `{"users":[]}`.

- [ ] **Step 6: Clean up temp cookie files**

```bash
rm -f /tmp/guest_cookies.txt /tmp/admin_cookies.txt
```

No commit for this task (verification only, no file changes).

---

### Task 7: `LoginStatsSection.tsx` — chart, toggle, date filter

**Files:**
- Create: `app/admin/dashboard/_components/LoginStatsSection.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/login-stats` (Task 4), `SegmentedControl` (`components/campus/SegmentedControl.tsx`), `useChartColors`/`ChartTooltip` (`components/sysacadws/charts/common.tsx`), `recharts` (`Bar`, `BarChart`, `CartesianGrid`, `ResponsiveContainer`, `Tooltip`, `XAxis`, `YAxis`).
- Produces: default export `LoginStatsSection`, and exports `type DateRange = { from: string; to: string }` used by Task 8 (`LoginEventsModal`) to receive the same filter state.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import SegmentedControl from "@/components/campus/SegmentedControl";
import { ChartTooltip, useChartColors } from "@/components/sysacadws/charts/common";
import LoginEventsModal from "./LoginEventsModal";

type Granularity = "day" | "month";

export interface DateRange {
  from: string; // "YYYY-MM-DD"
  to: string; // "YYYY-MM-DD"
}

interface SeriesPoint {
  period: string;
  distinctUsers: number;
}

interface LoginStatsResponse {
  series: SeriesPoint[];
  todayDistinctUsers: number;
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(granularity: Granularity): DateRange {
  const to = new Date();
  const from = new Date(to);
  if (granularity === "day") from.setDate(from.getDate() - 29);
  else from.setMonth(from.getMonth() - 11);
  return { from: toDateInput(from), to: toDateInput(to) };
}

/** Sección "Uso del Campus" de /admin/dashboard: métrica de hoy + gráfico + filtro. */
export default function LoginStatsSection() {
  const colors = useChartColors();
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [range, setRange] = useState<DateRange>(() => defaultRange("day"));
  const [rangeTouched, setRangeTouched] = useState(false);
  const [data, setData] = useState<LoginStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  function changeGranularity(next: string) {
    const g = next as Granularity;
    setGranularity(g);
    if (!rangeTouched) setRange(defaultRange(g));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ granularity, from: range.from, to: range.to });
    fetch(`/api/admin/login-stats?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData({ series: [], todayDistinctUsers: 0 });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [granularity, range.from, range.to]);

  const series = data?.series ?? [];
  const hasData = series.some((s) => s.distinctUsers > 0);

  return (
    <section className="mb-7">
      <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
        Uso del Campus
      </p>
      <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm p-4">
        <div className="flex items-center gap-3 mb-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[rgba(52,199,89,0.12)] text-[#34c759]">
            <Users className="h-[22px] w-[22px]" />
          </span>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
              Personas distintas hoy
            </p>
            <p className="text-[26px] font-bold tracking-tight text-[var(--fg)] leading-none tabular-nums">
              {data ? data.todayDistinctUsers : "—"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <SegmentedControl
            ariaLabel="Granularidad"
            value={granularity}
            onChange={changeGranularity}
            options={[
              { value: "day", label: "Diario" },
              { value: "month", label: "Mensual" },
            ]}
          />
          <div className="flex items-center gap-1.5 text-[13px]">
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => {
                setRangeTouched(true);
                setRange((r) => ({ ...r, from: e.target.value }));
              }}
              className="rounded-lg border border-[var(--separator)] bg-[var(--surface2)] px-2 py-1.5 text-[var(--fg)]"
            />
            <span className="text-[var(--secondary)]">a</span>
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => {
                setRangeTouched(true);
                setRange((r) => ({ ...r, to: e.target.value }));
              }}
              className="rounded-lg border border-[var(--separator)] bg-[var(--surface2)] px-2 py-1.5 text-[var(--fg)]"
            />
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="ml-auto rounded-full bg-[var(--surface2)] px-3.5 py-1.5 text-[13px] font-semibold text-[#007aff] active:opacity-70"
          >
            Ver mails
          </button>
        </div>

        {loading ? (
          <p className="text-[13px] text-[var(--secondary)] text-center py-10">Cargando…</p>
        ) : !hasData ? (
          <p className="text-[13px] text-[var(--secondary)] text-center py-10">Sin datos en este rango.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
              <XAxis dataKey="period" tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="distinctUsers" name="Personas distintas" fill="#34c759" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <LoginEventsModal open={modalOpen} onClose={() => setModalOpen(false)} from={range.from} to={range.to} />
    </section>
  );
}
```

Note: this imports `LoginEventsModal` from `./LoginEventsModal`, which doesn't exist yet — that's fine, Task 8 creates it next. The build/type-check in Step 2 below will fail until Task 8 lands; that's expected and called out there.

- [ ] **Step 2: Confirm the expected failure**

Run: `npx tsc --noEmit`
Expected: an error about `./LoginEventsModal` not being found. This confirms the file compiles otherwise and is wired correctly — proceed to Task 8 before committing either file.

---

### Task 8: `LoginEventsModal.tsx` — searchable list

**Files:**
- Create: `app/admin/dashboard/_components/LoginEventsModal.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/login-events` (Task 4), `DateRange` type (Task 7, structurally — plain `{ from: string; to: string }` props, no import needed).
- Produces: default export `LoginEventsModal`, props `{ open: boolean; onClose: () => void; from: string; to: string }`. Consumed by Task 7's `LoginStatsSection`.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";

interface UserSummary {
  userKey: string;
  fullname: string | null;
  loginCount: number;
  lastLoginAt: string;
}

/** Modal con buscador: personas distintas que iniciaron sesión en el rango dado. */
export default function LoginEventsModal({
  open,
  onClose,
  from,
  to,
}: {
  open: boolean;
  onClose: () => void;
  from: string;
  to: string;
}) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ from, to });
      if (q.trim()) params.set("q", q.trim());
      fetch(`/api/admin/login-events?${params}`)
        .then((r) => r.json())
        .then((json) => setUsers(json.users ?? []))
        .catch(() => setUsers([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [open, from, to, q]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-6"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
      role="dialog"
      aria-modal="true"
    >
      <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={onClose} />

      <div className="relative w-full sm:max-w-md max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-[var(--separator)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[17px] font-bold text-[var(--fg)]">Personas que ingresaron</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[var(--surface2)] flex items-center justify-center active:opacity-70"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4 text-[var(--secondary)]" />
          </button>
        </div>

        <div className="px-5 pb-3">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--separator)] bg-[var(--surface2)] px-3 py-2.5">
            <Search className="w-4 h-4 text-[var(--secondary)]" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por mail o nombre"
              className="flex-1 bg-transparent outline-none text-[15px] text-[var(--fg)] placeholder:text-[var(--secondary)]"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 divide-y divide-[var(--separator)]">
          {loading ? (
            <p className="text-[13px] text-[var(--secondary)] text-center py-8">Buscando…</p>
          ) : users.length === 0 ? (
            <p className="text-[13px] text-[var(--secondary)] text-center py-8">Sin resultados.</p>
          ) : (
            users.map((u) => (
              <div key={u.userKey} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-[var(--fg)] truncate">{u.userKey}</p>
                  {u.fullname && <p className="text-[12px] text-[var(--secondary)] truncate">{u.fullname}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[13px] font-semibold text-[var(--fg)] tabular-nums">{u.loginCount}×</p>
                  <p className="text-[11px] text-[var(--secondary)]">{new Date(u.lastLoginAt).toLocaleDateString("es-AR")}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors — this also confirms Task 7's `LoginStatsSection.tsx` now resolves its import correctly.

- [ ] **Step 3: Commit both files together**

They were built as one unit (Task 7 alone doesn't compile), so commit together:

```bash
git add app/admin/dashboard/_components/LoginStatsSection.tsx app/admin/dashboard/_components/LoginEventsModal.tsx
git commit -m "feat(admin): add login stats chart and searchable mail modal"
```

---

### Task 9: Wire into `AdminDashboardClient.tsx` and verify in the browser

**Files:**
- Modify: `app/admin/dashboard/_components/AdminDashboardClient.tsx`

**Interfaces:**
- Consumes: `LoginStatsSection` (Task 7/8).

- [ ] **Step 1: Render the new section**

In `app/admin/dashboard/_components/AdminDashboardClient.tsx`, add the import near the other component imports:

```ts
import LoginStatsSection from "./LoginStatsSection";
```

Render it as the first `<section>` inside `<main>`, right after the `<Breadcrumb>`/title block and before the existing `<section className="mb-7">` that lists "Herramientas" (so the metric is the first thing the admin sees, per the original ask of seeing it directly on `/admin/dashboard`):

```tsx
        <LoginStatsSection />

        <section className="mb-7">
          <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
            Herramientas
          </p>
```

(That opening `<section>` line already exists — only the `<LoginStatsSection />` line above it is new.)

- [ ] **Step 2: Type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Manual verification in the browser**

With the dev server running and logged in as admin (via `/admin/login`):

1. Open `http://localhost:3000/admin/dashboard`.
2. Confirm the "Uso del Campus" card renders above "Herramientas", with a "Personas distintas hoy" number, the Diario/Mensual toggle, two date inputs, a bar chart, and a "Ver mails" button.
3. Click "Diario" vs "Mensual" — confirm the chart re-fetches and the x-axis labels switch between `YYYY-MM-DD`-ish daily labels and `YYYY-MM` monthly labels.
4. Change the "Desde" date input to a narrower range — confirm the chart updates.
5. Click "Ver mails" — confirm the modal opens, lists at least the `invitado` entry (from Task 6's guest login, if that session is still in the table), and typing a non-matching search string empties the list.
6. Toggle dark mode (if the app has a theme switch, or via OS-level dark mode) — confirm the chart grid/text and modal colors adapt (they're driven by the same CSS vars/`useChartColors` as the rest of the dashboard, so this should hold automatically).

- [ ] **Step 4: Commit**

```bash
git add app/admin/dashboard/_components/AdminDashboardClient.tsx
git commit -m "feat(admin): show login stats section on the admin dashboard"
```
