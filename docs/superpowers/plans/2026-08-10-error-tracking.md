# Tracking de errores en /admin/dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar automáticamente los errores de cliente y servidor de toda la app, y mostrarlos en `/admin/dashboard` agrupados por criticidad, con un modal de detalle por error (fecha, sección, consola/stack) y botón de copiar.

**Architecture:** Un endpoint público (`POST /api/errors`) recibe reportes del navegador; `instrumentation-client.ts` los genera parcheando `console.warn`/`console.error` y escuchando `error`/`unhandledrejection`; `instrumentation.ts` con `onRequestError` captura errores de servidor directamente (sin pasar por HTTP). Todo se guarda en una tabla Supabase (`error_events`) vía `lib/errorEvents.ts`, con agregación pura en `lib/errorEventStats.ts`. El admin lee vía dos rutas protegidas (`/api/admin/error-stats`, `/api/admin/error-events`) y una nueva sección `ErrorStatsSection` + `ErrorEventsModal` en el dashboard, siguiendo el mismo patrón visual que `LoginStatsSection`/`LoginEventsModal`.

**Tech Stack:** Next.js 16 App Router (`instrumentation.ts`, `instrumentation-client.ts`, `app/error.tsx`, `app/global-error.tsx`), TypeScript, Supabase (REST vía `lib/supabase.ts`), recharts, Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-error-tracking-design.md` — toda tarea implementa una sección de ese documento.
- **No hay test suite configurado en este repo** (`CLAUDE.md`). La verificación de funciones puras se hace con scripts ad-hoc ejecutados directo con `node` (Node 24 corre `.ts` nativamente sin transpilar, ya verificado en este entorno), y el resto se verifica con `npm run build` + `npm run lint` + prueba manual con el dev server.
- Todo el camino de escritura (`logErrorEvent`, patch de consola, `onRequestError`) es **best-effort**: nunca debe lanzar ni romper la app que lo llama.
- Fechas de agregación en hora Argentina (UTC-3 fijo), reusando `periodKey`/`resolveDateRange`/`argentinaTodayRangeISO` de `lib/loginEventStats.ts` — no se reimplementa la lógica de fechas.
- Nunca se guardan headers `cookie` ni `authorization` de las requests de servidor — solo se extrae `user-agent` con allowlist explícito.
- Textos (`message`, `stack`, `console_log[].args`) se truncan a 4000 caracteres antes de guardar. Buffer de consola: últimas 30 entradas. Deduplicación de envíos desde cliente: mismo `severity:message:section` no se reenvía dentro de una ventana de 30s, con tope de 50 reportes por sesión de pestaña.
- Estilo visual: variables CSS (`var(--fg)`, `var(--surface)`, etc.), mismo lenguaje que `LoginStatsSection.tsx`/`LoginEventsModal.tsx`. Colores de severidad: crítico `#ff3b30`, error `#ff9500`, warning `#ffcc00`.
- Rutas admin protegidas con `isAdminRequest` de `lib/adminAuth.ts`, igual que `login-stats`/`login-events`.

---

### Task 1: Schema de Supabase

**Files:**
- Create: `scripts/error-events.sql`

**Interfaces:**
- Produces: tabla `error_events` (columnas: `id`, `severity`, `source`, `message`, `stack`, `section`, `console_log`, `request_info`, `user_agent`, `created_at`) que consume `lib/errorEvents.ts` en la Task 3.

- [ ] **Step 1: Crear el archivo SQL**

```sql
-- Registro de errores de toda la app (cliente + servidor), append-only.
-- Ver docs/superpowers/specs/2026-08-10-error-tracking-design.md
create table error_events (
  id bigserial primary key,
  severity text not null check (severity in ('critical', 'error', 'warning')),
  source text not null check (source in ('client', 'server')),
  message text not null,
  stack text,
  section text,
  console_log jsonb,
  request_info jsonb,
  user_agent text,
  created_at timestamptz not null default now()
);
create index error_events_created_at_idx on error_events (created_at);
create index error_events_severity_idx on error_events (severity);
```

- [ ] **Step 2: Avisar al usuario que corra el SQL en Supabase**

Este paso no es automatizable: el archivo queda commiteado como referencia, pero
la tabla debe crearse manualmente en el SQL editor del panel de Supabase del
proyecto (mismo flujo que se usó para `login_events`/`device_sessions`).

- [ ] **Step 3: Commit**

```bash
git add scripts/error-events.sql
git commit -m "Agrega schema SQL para error_events"
```

---

### Task 2: Agregación pura de errores por severidad

**Files:**
- Modify: `lib/loginEventStats.ts:91` (exportar `enumeratePeriods`)
- Create: `lib/errorEventStats.ts`

**Interfaces:**
- Consumes: `periodKey(iso, granularity)`, `type Granularity`, `enumeratePeriods(fromISO, toISO, granularity)` de `lib/loginEventStats.ts`.
- Produces (usado por Task 3 y las rutas admin en Task 8):
  - `type Severity = "critical" | "error" | "warning"`
  - `type Source = "client" | "server"`
  - `interface ConsoleEntry { level: string; args: string; at: string }`
  - `interface ErrorEventRow { id: number; severity: Severity; source: Source; message: string; stack: string | null; section: string | null; console_log: ConsoleEntry[] | null; request_info: Record<string, unknown> | null; user_agent: string | null; created_at: string }`
  - `interface SeverityCounts { critical: number; error: number; warning: number }`
  - `interface SeveritySeriesPoint extends SeverityCounts { period: string }`
  - `buildSeverityStats(rows: ErrorEventRow[]): SeverityCounts`
  - `buildSeveritySeries(rows: ErrorEventRow[], granularity: Granularity, fromISO: string, toISO: string): SeveritySeriesPoint[]`

- [ ] **Step 1: Exportar `enumeratePeriods` en `lib/loginEventStats.ts`**

En `lib/loginEventStats.ts:91`, cambiar:

```ts
function enumeratePeriods(fromISO: string, toISO: string, granularity: Granularity): string[] {
```

por:

```ts
export function enumeratePeriods(fromISO: string, toISO: string, granularity: Granularity): string[] {
```

(sin otro cambio — la función ya existe y su lógica no cambia).

- [ ] **Step 2: Escribir `lib/errorEventStats.ts`**

```ts
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
```

- [ ] **Step 3: Verificar con un script ad-hoc**

Crear un archivo temporal (fuera del repo, en el scratchpad) que importe y
ejercite las funciones:

```ts
// C:\Users\Asus\AppData\Local\Temp\claude\...\scratchpad\verify-error-stats.ts
import { buildSeverityStats, buildSeveritySeries, type ErrorEventRow } from "../../../../lib/errorEventStats";
```

Ajustar el import relativo a la ruta real del repo (o copiar las funciones
sin el alias `@/` para probarlas aisladas). Contenido de la prueba:

```ts
const rows: ErrorEventRow[] = [
  { id: 1, severity: "critical", source: "client", message: "a", stack: null, section: "/x", console_log: null, request_info: null, user_agent: null, created_at: "2026-08-10T15:00:00.000Z" },
  { id: 2, severity: "error", source: "server", message: "b", stack: null, section: "/y", console_log: null, request_info: null, user_agent: null, created_at: "2026-08-10T15:05:00.000Z" },
  { id: 3, severity: "warning", source: "client", message: "c", stack: null, section: "/x", console_log: null, request_info: null, user_agent: null, created_at: "2026-08-09T10:00:00.000Z" },
];

console.log(buildSeverityStats(rows));
// esperado: { critical: 1, error: 1, warning: 1 }

const series = buildSeveritySeries(rows, "day", "2026-08-09T00:00:00.000-03:00", "2026-08-10T23:59:59.999-03:00");
console.log(series);
// esperado: [{ period: "2026-08-09", critical: 0, error: 0, warning: 1 }, { period: "2026-08-10", critical: 1, error: 1, warning: 0 }]
```

Run: `node <ruta-del-script>.ts`
Expected: los dos `console.log` imprimen exactamente los valores esperados
en los comentarios. Borrar el script temporal después de verificar.

- [ ] **Step 4: Typecheck del proyecto completo**

Run: `npm run build`
Expected: build exitoso, sin errores de TypeScript en `lib/errorEventStats.ts` ni `lib/loginEventStats.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/loginEventStats.ts lib/errorEventStats.ts
git commit -m "Agrega agregación pura de error_events por severidad"
```

---

### Task 3: Capa de acceso a Supabase para error_events

**Files:**
- Create: `lib/errorEvents.ts`

**Interfaces:**
- Consumes: `supabaseFetch` de `lib/supabase.ts`; todos los tipos/funciones de `lib/errorEventStats.ts` (Task 2).
- Produces (usado por Task 4 — ingesta — y Task 8 — rutas admin):
  - `logErrorEvent(params: { severity: Severity; source: Source; message: string; stack?: string | null; section?: string | null; consoleLog?: ConsoleEntry[] | null; requestInfo?: Record<string, unknown> | null; userAgent?: string | null }): Promise<void>`
  - `fetchErrorEventsInRange(fromISO: string, toISO: string): Promise<ErrorEventRow[]>`
  - Reexporta `Severity`, `Source`, `ConsoleEntry`, `ErrorEventRow`, `Granularity`, `periodKey`, `resolveDateRange`, `argentinaTodayRangeISO`, `buildSeverityStats`, `buildSeveritySeries`.

- [ ] **Step 1: Escribir `lib/errorEvents.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add lib/errorEvents.ts
git commit -m "Agrega lib/errorEvents.ts para leer/escribir error_events en Supabase"
```

---

### Task 4: Endpoint público de ingesta

**Files:**
- Create: `app/api/errors/route.ts`

**Interfaces:**
- Consumes: `logErrorEvent` y `type ConsoleEntry`, `type Severity` de `lib/errorEvents.ts` (Task 3).
- Produces: `POST /api/errors` — endpoint HTTP público que consumirá `lib/clientErrorReporter.ts` (Task 5).

- [ ] **Step 1: Escribir `app/api/errors/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { logErrorEvent, type ConsoleEntry, type Severity } from "@/lib/errorEvents";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 4000;
const MAX_CONSOLE_ENTRIES = 30;
const VALID_SEVERITIES: Severity[] = ["critical", "error", "warning"];

function truncate(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

function sanitizeConsoleLog(value: unknown): ConsoleEntry[] | null {
  if (!Array.isArray(value)) return null;
  return value.slice(0, MAX_CONSOLE_ENTRIES).map((entry) => ({
    level: typeof entry?.level === "string" ? entry.level.slice(0, 20) : "log",
    args: truncate(entry?.args, MAX_TEXT_LENGTH) ?? "",
    at: typeof entry?.at === "string" ? entry.at : new Date().toISOString(),
  }));
}

/** Ingesta pública de errores de cliente. Nunca debe lanzar (evita reportar-se a sí mismo). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const severity = VALID_SEVERITIES.includes(body?.severity) ? (body.severity as Severity) : null;
    const message = truncate(body?.message, MAX_TEXT_LENGTH);
    if (!severity || !message) {
      return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
    }

    await logErrorEvent({
      severity,
      source: "client",
      message,
      stack: truncate(body?.stack, MAX_TEXT_LENGTH),
      section: truncate(body?.section, 500),
      consoleLog: sanitizeConsoleLog(body?.consoleLog),
      userAgent: truncate(req.headers.get("user-agent"), 500),
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Probar el endpoint manualmente**

Run: `npm run dev` (en una terminal aparte, dejarlo corriendo) y en otra:

```bash
curl -s -X POST http://localhost:3000/api/errors \
  -H "Content-Type: application/json" \
  -d '{"severity":"warning","message":"prueba manual"}'
```

Expected: respuesta `{"ok":true}`. Si la tabla `error_events` todavía no fue
creada en Supabase (Task 1, Step 2 pendiente), igual debe responder
`{"ok":true}` porque `logErrorEvent` es best-effort — verificar que el
`curl` no cuelga ni tira 500.

- [ ] **Step 4: Commit**

```bash
git add app/api/errors/route.ts
git commit -m "Agrega POST /api/errors como endpoint público de ingesta"
```

---

### Task 5: Captura de errores en el cliente

**Files:**
- Create: `lib/clientErrorReporter.ts`
- Create: `instrumentation-client.ts` (raíz del proyecto, junto a `next.config.ts`)

**Interfaces:**
- Consumes: nada de otras tasks (hace `fetch("/api/errors")` directo, sin importar `lib/errorEvents.ts` porque corre en el navegador).
- Produces (usado por Task 6 — error boundaries):
  - `initClientErrorTracking(): void`
  - `reportClientError(severity: "critical" | "error" | "warning", message: string, extra?: { stack?: string | null }): void`

- [ ] **Step 1: Escribir `lib/clientErrorReporter.ts`**

```ts
"use client";

/**
 * Captura de errores del navegador: parchea console.warn/console.error,
 * escucha window "error"/"unhandledrejection", y expone reportClientError
 * para que la usen los error boundaries de React (app/error.tsx,
 * app/global-error.tsx). Todo es best-effort: nunca debe romper la app.
 */

type Severity = "critical" | "error" | "warning";

interface ConsoleEntry {
  level: string;
  args: string;
  at: string;
}

const CONSOLE_BUFFER_SIZE = 30;
const DEDUPE_WINDOW_MS = 30_000;
const MAX_REPORTS_PER_SESSION = 50;

const consoleBuffer: ConsoleEntry[] = [];
const lastSentAt = new Map<string, number>();
let reportCount = 0;
let initialized = false;

function stringifyArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? a.message;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function pushConsoleEntry(level: string, text: string) {
  consoleBuffer.push({ level, args: text, at: new Date().toISOString() });
  if (consoleBuffer.length > CONSOLE_BUFFER_SIZE) consoleBuffer.shift();
}

function shouldSend(key: string): boolean {
  if (reportCount >= MAX_REPORTS_PER_SESSION) return false;
  const now = Date.now();
  const last = lastSentAt.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  lastSentAt.set(key, now);
  reportCount += 1;
  return true;
}

function sendReport(payload: {
  severity: Severity;
  message: string;
  stack?: string | null;
  consoleLog?: ConsoleEntry[];
}) {
  try {
    const section = window.location.pathname;
    const key = `${payload.severity}:${payload.message}:${section}`;
    if (!shouldSend(key)) return;

    const body = JSON.stringify({
      severity: payload.severity,
      message: payload.message,
      stack: payload.stack ?? null,
      section,
      consoleLog: payload.consoleLog ?? [...consoleBuffer],
    });

    fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* nunca debe romper la app */
  }
}

/** Inicializa la captura global. Idempotente — instrumentation-client.ts la llama una vez. */
export function initClientErrorTracking(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    const message = stringifyArgs(args);
    sendReport({ severity: "warning", message, consoleLog: [...consoleBuffer] });
    pushConsoleEntry("warn", message);
  };

  console.error = (...args: unknown[]) => {
    originalError(...args);
    const message = stringifyArgs(args);
    sendReport({ severity: "error", message, consoleLog: [...consoleBuffer] });
    pushConsoleEntry("error", message);
  };

  window.addEventListener("error", (event) => {
    sendReport({
      severity: "error",
      message: event.message || "Error desconocido",
      stack: event.error?.stack ?? null,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    sendReport({
      severity: "error",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? (reason.stack ?? null) : null,
    });
  });
}

/** Usado por app/error.tsx y app/global-error.tsx cuando un error boundary atrapa una excepción. */
export function reportClientError(
  severity: Severity,
  message: string,
  extra?: { stack?: string | null }
): void {
  sendReport({ severity, message, stack: extra?.stack ?? null });
}
```

- [ ] **Step 2: Escribir `instrumentation-client.ts` en la raíz del proyecto**

```ts
import { initClientErrorTracking } from "@/lib/clientErrorReporter";

initClientErrorTracking();
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build exitoso. Confirmar en el output de build que Next reconoce
`instrumentation-client.ts` (no debe haber warning de archivo ignorado).

- [ ] **Step 4: Probar manualmente en el navegador**

Run: `npm run dev`, abrir `http://localhost:3000` en el navegador, abrir la
consola de DevTools y ejecutar `console.warn("prueba")`.
Expected: en la pestaña Network aparece un `POST /api/errors` con body
`{"severity":"warning","message":"prueba",...}`.

- [ ] **Step 5: Commit**

```bash
git add lib/clientErrorReporter.ts instrumentation-client.ts
git commit -m "Agrega captura de errores de cliente (console, window.onerror, unhandledrejection)"
```

---

### Task 6: Error boundaries de React (severidad crítica)

**Files:**
- Create: `app/error.tsx`
- Create: `app/global-error.tsx`

**Interfaces:**
- Consumes: `reportClientError` de `lib/clientErrorReporter.ts` (Task 5).
- Produces: nada consumido por otras tasks — son hojas de la UI.

- [ ] **Step 1: Escribir `app/error.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/clientErrorReporter";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    reportClientError("critical", error.message, { stack: error.stack ?? null });
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-[var(--bg)]">
      <p className="text-[17px] font-semibold text-[var(--fg)]">Algo salió mal</p>
      <p className="text-[13px] text-[var(--secondary)]">Esta pantalla tuvo un error inesperado.</p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="rounded-full bg-[#007aff] px-5 py-2.5 text-[15px] font-semibold text-white active:opacity-70"
      >
        Reintentar
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Escribir `app/global-error.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/clientErrorReporter";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    reportClientError("critical", error.message, { stack: error.stack ?? null });
  }, [error]);

  return (
    <html>
      <body>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "1.5rem", textAlign: "center", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>
          <p style={{ fontSize: 17, fontWeight: 600 }}>Algo salió mal</p>
          <p style={{ fontSize: 13, color: "#8e8e93" }}>La aplicación tuvo un error inesperado.</p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{ borderRadius: 9999, background: "#007aff", color: "white", padding: "10px 20px", fontSize: 15, fontWeight: 600, border: "none" }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
```

`global-error.tsx` reemplaza el `<html>`/`<body>` del root layout, por eso no
puede usar las variables CSS de `app/globals.css` (no se cargan) — se usa
estilo inline con los mismos valores de color.

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Probar manualmente forzando un error**

Agregar temporalmente `throw new Error("prueba boundary")` al inicio del
render de `app/dashboard/page.tsx`, correr `npm run dev`, navegar a
`/dashboard`.
Expected: se ve la pantalla de fallback de `app/error.tsx` ("Algo salió
mal") y en Network aparece `POST /api/errors` con `severity: "critical"`.
Sacar el `throw` de prueba antes de continuar.

- [ ] **Step 5: Commit**

```bash
git add app/error.tsx app/global-error.tsx
git commit -m "Agrega error boundaries de React (severidad crítica) con reporte automático"
```

---

### Task 7: Captura de errores en el servidor

**Files:**
- Create: `instrumentation.ts` (raíz del proyecto, junto a `next.config.ts`)

**Interfaces:**
- Consumes: `logErrorEvent` de `lib/errorEvents.ts` (Task 3).
- Produces: nada consumido por otras tasks — Next.js lo invoca automáticamente.

- [ ] **Step 1: Escribir `instrumentation.ts`**

```ts
import { type Instrumentation } from "next";
import { logErrorEvent } from "@/lib/errorEvents";

function pickUserAgent(headers: NodeJS.Dict<string | string[]>): string | null {
  const ua = headers["user-agent"];
  if (!ua) return null;
  return Array.isArray(ua) ? (ua[0] ?? null) : ua;
}

/**
 * Captura errores de servidor (API routes, render de páginas, actions) sin
 * tocar cada route handler. Solo se guarda `user-agent` de los headers de
 * request — nunca `cookie` ni `authorization`, para no filtrar tokens de
 * sesión a la tabla de errores.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const err = error as { message?: string; stack?: string; digest?: string };
  await logErrorEvent({
    severity: context.routeType === "render" ? "critical" : "error",
    source: "server",
    message: err.message ?? "Error desconocido",
    stack: err.stack ?? null,
    section: request.path,
    requestInfo: {
      method: request.method,
      routeType: context.routeType,
      routePath: context.routePath,
      digest: err.digest ?? null,
    },
    userAgent: pickUserAgent(request.headers),
  });
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build exitoso, sin error de tipos en la firma de `onRequestError`.

- [ ] **Step 3: Probar manualmente forzando un error de servidor**

Agregar temporalmente `throw new Error("prueba server")` al inicio del
`GET` de algún route handler simple (ej. `app/api/admin/logout/route.ts`),
correr `npm run dev`, y hacer `curl -X POST http://localhost:3000/api/admin/logout`.
Expected: la request devuelve 500, y en la terminal del dev server no debe
aparecer ninguna excepción no capturada relacionada a `onRequestError`
(si Supabase todavía no tiene la tabla, `logErrorEvent` degrada en
silencio). Sacar el `throw` de prueba antes de continuar.

- [ ] **Step 4: Commit**

```bash
git add instrumentation.ts
git commit -m "Agrega captura de errores de servidor vía onRequestError"
```

---

### Task 8: Rutas admin de lectura

**Files:**
- Create: `app/api/admin/error-stats/route.ts`
- Create: `app/api/admin/error-events/route.ts`

**Interfaces:**
- Consumes: `isAdminRequest` de `lib/adminAuth.ts`; `argentinaTodayRangeISO`, `buildSeverityStats`, `buildSeveritySeries`, `fetchErrorEventsInRange`, `resolveDateRange`, `type Granularity`, `type Severity` de `lib/errorEvents.ts` (Task 3).
- Produces: `GET /api/admin/error-stats?granularity=&from=&to=` → `{ series: SeveritySeriesPoint[]; todayCounts: SeverityCounts }`; `GET /api/admin/error-events?from=&to=&severity=&q=` → `{ events: { id, severity, source, message, stack, section, consoleLog, requestInfo, userAgent, createdAt }[] }`. Consumidos por `ErrorStatsSection.tsx` (Task 9) y `ErrorEventsModal.tsx` (Task 10).

- [ ] **Step 1: Escribir `app/api/admin/error-stats/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import {
  argentinaTodayRangeISO,
  buildSeverityStats,
  buildSeveritySeries,
  fetchErrorEventsInRange,
  resolveDateRange,
  type Granularity,
} from "@/lib/errorEvents";

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
    fetchErrorEventsInRange(fromISO, toISO),
    fetchErrorEventsInRange(today.fromISO, today.toISO),
  ]);

  return NextResponse.json({
    series: buildSeveritySeries(rangeRows, granularity, fromISO, toISO),
    todayCounts: buildSeverityStats(todayRows),
  });
}
```

- [ ] **Step 2: Escribir `app/api/admin/error-events/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { fetchErrorEventsInRange, resolveDateRange, type Severity } from "@/lib/errorEvents";

export const runtime = "nodejs";

const VALID_SEVERITIES: Severity[] = ["critical", "error", "warning"];

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { fromISO, toISO } = resolveDateRange(
    req.nextUrl.searchParams.get("from"),
    req.nextUrl.searchParams.get("to"),
    "day"
  );
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() || null;
  const severityParam = req.nextUrl.searchParams.get("severity");
  const severity = VALID_SEVERITIES.includes(severityParam as Severity) ? (severityParam as Severity) : null;

  let rows = await fetchErrorEventsInRange(fromISO, toISO);
  if (severity) rows = rows.filter((r) => r.severity === severity);
  if (q) {
    rows = rows.filter(
      (r) => r.message.toLowerCase().includes(q) || (r.section ?? "").toLowerCase().includes(q)
    );
  }

  return NextResponse.json({
    events: rows.map((r) => ({
      id: r.id,
      severity: r.severity,
      source: r.source,
      message: r.message,
      stack: r.stack,
      section: r.section,
      consoleLog: r.console_log,
      requestInfo: r.request_info,
      userAgent: r.user_agent,
      createdAt: r.created_at,
    })),
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Probar manualmente sin sesión admin**

Run: `npm run dev` y `curl -s http://localhost:3000/api/admin/error-stats`
Expected: `{"error":"No autorizado"}` con status 401 (no hay cookie de
sesión admin en el curl).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/error-stats/route.ts app/api/admin/error-events/route.ts
git commit -m "Agrega rutas admin de lectura para error_events"
```

---

### Task 9: Sección de estadísticas en el dashboard

**Files:**
- Create: `app/admin/dashboard/_components/ErrorStatsSection.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/error-stats` (Task 8); `SegmentedControl` de `components/campus/SegmentedControl.tsx`; `ChartTooltip`, `useChartColors` de `components/sysacadws/charts/common.tsx`; `ErrorEventsModal` (Task 10 — se importa acá pero se implementa después, ver Step 1 de la Task 10).
- Produces: componente `<ErrorStatsSection />` sin props, consumido por `AdminDashboardClient.tsx` (Task 11).

- [ ] **Step 1: Escribir `app/admin/dashboard/_components/ErrorStatsSection.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import SegmentedControl from "@/components/campus/SegmentedControl";
import { ChartTooltip, useChartColors } from "@/components/sysacadws/charts/common";
import ErrorEventsModal from "./ErrorEventsModal";

type Granularity = "day" | "month";
type Severity = "critical" | "error" | "warning";

export interface DateRange {
  from: string;
  to: string;
}

interface SeverityPoint {
  period: string;
  critical: number;
  error: number;
  warning: number;
}

interface ErrorStatsResponse {
  series: SeverityPoint[];
  todayCounts: { critical: number; error: number; warning: number };
}

const SEVERITY_COLORS: Record<Severity, string> = { critical: "#ff3b30", error: "#ff9500", warning: "#ffcc00" };
const SEVERITY_LABELS: Record<Severity, string> = { critical: "Crítico", error: "Error", warning: "Warning" };
const SEVERITY_ORDER: Severity[] = ["critical", "error", "warning"];

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

/** Sección "Errores" de /admin/dashboard: cantidad de errores por criticidad + gráfico + filtro. */
export default function ErrorStatsSection() {
  const colors = useChartColors();
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [range, setRange] = useState<DateRange>(() => defaultRange("day"));
  const [rangeTouched, setRangeTouched] = useState(false);
  const [data, setData] = useState<ErrorStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalKey, setModalKey] = useState(0);

  function changeGranularity(next: string) {
    const g = next as Granularity;
    setGranularity(g);
    if (!rangeTouched) setRange(defaultRange(g));
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    const params = new URLSearchParams({ granularity, from: range.from, to: range.to });
    fetch(`/api/admin/error-stats?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData({ series: [], todayCounts: { critical: 0, error: 0, warning: 0 } });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [granularity, range.from, range.to]);

  const series = data?.series ?? [];
  const hasData = series.some((s) => s.critical + s.error + s.warning > 0);
  const today = data?.todayCounts ?? { critical: 0, error: 0, warning: 0 };

  return (
    <section className="mb-7">
      <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
        Errores
      </p>
      <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm p-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[rgba(255,59,48,0.12)] text-[#ff3b30]">
            <AlertTriangle className="h-[22px] w-[22px]" />
          </span>
          <div className="flex-1 flex flex-wrap gap-x-5 gap-y-1 min-w-[160px]">
            {SEVERITY_ORDER.map((sev) => (
              <div key={sev}>
                <p
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: SEVERITY_COLORS[sev] }}
                >
                  {SEVERITY_LABELS[sev]} hoy
                </p>
                <p className="text-[20px] font-bold tracking-tight text-[var(--fg)] leading-none tabular-nums">
                  {data ? today[sev] : "—"}
                </p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setModalKey((k) => k + 1);
              setModalOpen(true);
            }}
            className="rounded-full bg-[var(--surface2)] px-3.5 py-1.5 text-[13px] font-semibold text-[#007aff] active:opacity-70"
          >
            Ver más
          </button>
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
              <Bar dataKey="critical" name={SEVERITY_LABELS.critical} stackId="sev" fill={SEVERITY_COLORS.critical} />
              <Bar dataKey="error" name={SEVERITY_LABELS.error} stackId="sev" fill={SEVERITY_COLORS.error} />
              <Bar dataKey="warning" name={SEVERITY_LABELS.warning} stackId="sev" fill={SEVERITY_COLORS.warning} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <ErrorEventsModal key={modalKey} open={modalOpen} onClose={() => setModalOpen(false)} from={range.from} to={range.to} />
    </section>
  );
}
```

- [ ] **Step 2: No compilar todavía**

Este componente importa `./ErrorEventsModal`, que se crea recién en la Task
10 — es esperable que `npm run build` falle hasta terminar esa task. No
hace falta correr build acá.

- [ ] **Step 3: Commit**

```bash
git add app/admin/dashboard/_components/ErrorStatsSection.tsx
git commit -m "Agrega ErrorStatsSection: gráfico apilado de errores por criticidad"
```

---

### Task 10: Modal de detalle de errores

**Files:**
- Create: `app/admin/dashboard/_components/ErrorEventsModal.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/error-events` (Task 8); `SegmentedControl` de `components/campus/SegmentedControl.tsx`.
- Produces: componente `<ErrorEventsModal open to onClose from to />`, consumido por `ErrorStatsSection.tsx` (Task 9, ya escrito).

- [ ] **Step 1: Escribir `app/admin/dashboard/_components/ErrorEventsModal.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Search, X, Copy, Check, ChevronDown } from "lucide-react";
import SegmentedControl from "@/components/campus/SegmentedControl";

type Severity = "critical" | "error" | "warning";

interface ErrorEvent {
  id: number;
  severity: Severity;
  source: "client" | "server";
  message: string;
  stack: string | null;
  section: string | null;
  consoleLog: { level: string; args: string; at: string }[] | null;
  requestInfo: Record<string, unknown> | null;
  userAgent: string | null;
  createdAt: string;
}

const SEVERITY_COLORS: Record<Severity, string> = { critical: "#ff3b30", error: "#ff9500", warning: "#ffcc00" };
const SEVERITY_LABELS: Record<Severity, string> = { critical: "Crítico", error: "Error", warning: "Warning" };

function buildCopyText(e: ErrorEvent): string {
  const lines = [
    `Severidad: ${SEVERITY_LABELS[e.severity]}`,
    `Fecha: ${new Date(e.createdAt).toLocaleString("es-AR")}`,
    `Sección: ${e.section ?? "—"}`,
    `Origen: ${e.source === "client" ? "Cliente" : "Servidor"}`,
    `Mensaje: ${e.message}`,
  ];
  if (e.stack) lines.push("", "Stack:", e.stack);
  if (e.consoleLog?.length) {
    lines.push("", "Consola:");
    for (const c of e.consoleLog) lines.push(`[${c.level}] ${c.at}: ${c.args}`);
  }
  if (e.requestInfo) lines.push("", "Request:", JSON.stringify(e.requestInfo, null, 2));
  if (e.userAgent) lines.push("", `User agent: ${e.userAgent}`);
  return lines.join("\n");
}

/** Modal con buscador y filtro de severidad: errores individuales en el rango dado. */
export default function ErrorEventsModal({
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
  const [severity, setSeverity] = useState<string>("all");
  const [events, setEvents] = useState<ErrorEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ from, to });
      if (q.trim()) params.set("q", q.trim());
      if (severity !== "all") params.set("severity", severity);
      fetch(`/api/admin/error-events?${params}`)
        .then((r) => r.json())
        .then((json) => setEvents(json.events ?? []))
        .catch(() => setEvents([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [open, from, to, q, severity]);

  async function copy(e: ErrorEvent) {
    try {
      await navigator.clipboard.writeText(buildCopyText(e));
      setCopiedId(e.id);
      setTimeout(() => setCopiedId((id) => (id === e.id ? null : id)), 1500);
    } catch {
      /* clipboard puede no estar disponible (ej. sin HTTPS) */
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-6"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
      role="dialog"
      aria-modal="true"
    >
      <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={onClose} />

      <div className="relative w-full sm:max-w-lg max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-[var(--separator)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[17px] font-bold text-[var(--fg)]">Errores</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[var(--surface2)] flex items-center justify-center active:opacity-70"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4 text-[var(--secondary)]" />
          </button>
        </div>

        <div className="px-5 pb-3 space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--separator)] bg-[var(--surface2)] px-3 py-2.5">
            <Search className="w-4 h-4 text-[var(--secondary)]" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por mensaje o sección"
              className="flex-1 bg-transparent outline-none text-[15px] text-[var(--fg)] placeholder:text-[var(--secondary)]"
              autoFocus
            />
          </div>
          <SegmentedControl
            ariaLabel="Severidad"
            value={severity}
            onChange={setSeverity}
            options={[
              { value: "all", label: "Todos" },
              { value: "critical", label: "Crítico" },
              { value: "error", label: "Error" },
              { value: "warning", label: "Warning" },
            ]}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 divide-y divide-[var(--separator)]">
          {loading ? (
            <p className="text-[13px] text-[var(--secondary)] text-center py-8">Buscando…</p>
          ) : events.length === 0 ? (
            <p className="text-[13px] text-[var(--secondary)] text-center py-8">Sin resultados.</p>
          ) : (
            events.map((e) => {
              const expanded = expandedId === e.id;
              return (
                <div key={e.id} className="py-3">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 text-left"
                    onClick={() => setExpandedId(expanded ? null : e.id)}
                  >
                    <div className="min-w-0">
                      <p
                        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: SEVERITY_COLORS[e.severity] }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: SEVERITY_COLORS[e.severity] }} />
                        {SEVERITY_LABELS[e.severity]}
                      </p>
                      <p className="text-[14px] font-medium text-[var(--fg)] truncate">{e.message}</p>
                      <p className="text-[12px] text-[var(--secondary)] truncate">{e.section ?? "—"}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2 text-right">
                      <p className="text-[11px] text-[var(--secondary)]">{new Date(e.createdAt).toLocaleString("es-AR")}</p>
                      <ChevronDown className={`w-4 h-4 text-[var(--secondary)] transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {expanded && (
                    <div className="mt-2 rounded-xl bg-[var(--surface2)] p-3 space-y-2">
                      {e.stack && (
                        <pre className="text-[11px] text-[var(--fg)] whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                          {e.stack}
                        </pre>
                      )}
                      {e.consoleLog && e.consoleLog.length > 0 && (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {e.consoleLog.map((c, i) => (
                            <p key={i} className="text-[11px] text-[var(--secondary)] break-words">
                              <span className="font-semibold">[{c.level}]</span> {c.args}
                            </p>
                          ))}
                        </div>
                      )}
                      {e.requestInfo && (
                        <pre className="text-[11px] text-[var(--fg)] whitespace-pre-wrap break-words">
                          {JSON.stringify(e.requestInfo, null, 2)}
                        </pre>
                      )}
                      <button
                        type="button"
                        onClick={() => copy(e)}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-3 py-1.5 text-[12px] font-semibold text-[#007aff] active:opacity-70"
                      >
                        {copiedId === e.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedId === e.id ? "Copiado" : "Copiar"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build exitoso — esto ahora también valida `ErrorStatsSection.tsx`
de la Task 9, que dependía de este archivo.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sin errores en los archivos nuevos.

- [ ] **Step 4: Commit**

```bash
git add app/admin/dashboard/_components/ErrorEventsModal.tsx
git commit -m "Agrega ErrorEventsModal: lista de errores con detalle y copiar"
```

---

### Task 11: Integrar en el dashboard y verificación end-to-end

**Files:**
- Modify: `app/admin/dashboard/_components/AdminDashboardClient.tsx`

**Interfaces:**
- Consumes: `ErrorStatsSection` de `app/admin/dashboard/_components/ErrorStatsSection.tsx` (Task 9).

- [ ] **Step 1: Importar y renderizar `ErrorStatsSection`**

En `app/admin/dashboard/_components/AdminDashboardClient.tsx:8`, agregar el
import junto al de `LoginStatsSection`:

```tsx
import LoginStatsSection from "./LoginStatsSection";
import ErrorStatsSection from "./ErrorStatsSection";
```

Y en el render (`app/admin/dashboard/_components/AdminDashboardClient.tsx:55`),
agregar la sección justo debajo de `<LoginStatsSection />`:

```tsx
        <LoginStatsSection />

        <ErrorStatsSection />

        <section className="mb-7">
```

- [ ] **Step 2: Typecheck y lint completos**

Run: `npm run build && npm run lint`
Expected: ambos comandos terminan sin errores.

- [ ] **Step 3: Verificación manual end-to-end**

Con la tabla `error_events` ya creada en Supabase (Task 1, Step 2) y
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` configuradas:

1. Run: `npm run dev`.
2. Iniciar sesión como admin (`/admin/login`) y entrar a `/admin/dashboard`.
   Confirmar que aparece la sección "Errores" con los 3 contadores de hoy
   (probablemente en 0) y el gráfico ("Sin datos en este rango" si aún no
   hay errores).
3. En otra pestaña, en cualquier página del Campus, abrir la consola de
   DevTools y ejecutar `console.warn("prueba dashboard")`.
4. Volver a `/admin/dashboard` y refrescar. Confirmar que "Warning hoy" pasó
   a 1 y que el gráfico muestra una barra amarilla.
5. Tocar "Ver más": confirmar que el modal lista el evento con severidad
   Warning, mensaje "prueba dashboard" y la sección (pathname) correcta.
6. Expandir el evento y tocar "Copiar": confirmar que el botón cambia a
   "Copiado" y que pegar el portapapeles (`Ctrl+V` en cualquier editor)
   muestra el bloque de texto con severidad/fecha/sección/mensaje.
7. Filtrar por severidad "Crítico" en el modal: confirmar que la lista
   queda vacía (todavía no se generó ningún error crítico).

- [ ] **Step 4: Commit**

```bash
git add app/admin/dashboard/_components/AdminDashboardClient.tsx
git commit -m "Integra ErrorStatsSection en /admin/dashboard"
```

---

## Self-Review

**Cobertura del spec:**
- Niveles de criticidad (critical/error/warning) y su asignación automática → Task 2 (tipos), Task 5 (cliente), Task 7 (servidor).
- Modelo de datos `error_events` → Task 1.
- `lib/errorEvents.ts` / `lib/errorEventStats.ts` → Task 2, 3.
- Cliente: consola, `window.onerror`, `unhandledrejection`, deduplicación → Task 5.
- Error boundaries React (`app/error.tsx`, `app/global-error.tsx`) → Task 6.
- Servidor: `instrumentation.ts` con `onRequestError`, exclusión de headers sensibles → Task 7.
- Endpoint de ingesta `POST /api/errors` con truncado/validación → Task 4.
- Rutas admin `error-stats`/`error-events` → Task 8.
- UI: gráfico apilado por severidad, chips de hoy, modal con detalle/copiar → Task 9, 10.
- Integración en `AdminDashboardClient.tsx` → Task 11.
- "Fuera de alcance" del spec (alertas en tiempo real, agrupación de errores repetidos, Service Worker) — correctamente no tienen tasks.

**Placeholders:** ninguno — todos los pasos de código tienen implementación completa, no hay "TODO"/"agregar validación" sin mostrar cómo.

**Consistencia de tipos:** `Severity`/`Source`/`ConsoleEntry`/`ErrorEventRow` se definen una sola vez en `lib/errorEventStats.ts` (Task 2) y se reexportan sin redefinir en `lib/errorEvents.ts` (Task 3); las rutas admin (Task 8) y los componentes UI (Task 9, 10) usan los mismos nombres de campo (`consoleLog`, `requestInfo`, `createdAt` en camelCase del lado de la API/UI vs `console_log`/`request_info`/`created_at` snake_case del lado de Supabase — el mapeo ocurre explícitamente en `error-events/route.ts`).
