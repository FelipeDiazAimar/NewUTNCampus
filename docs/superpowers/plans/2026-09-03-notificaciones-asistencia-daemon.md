# Notificaciones de asistencia — daemon local + monitor + pruebas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando el sistema legacy de la facultad habilita la asistencia de una materia, mandar una push a la PWA (iOS + Android) de todos los usuarios con el aviso activado, con el nombre de la materia y link a `/asistencia`; más un monitor y control remoto del proceso que vigila, en `/admin/dashboard`.

**Architecture:** Un daemon Node standalone corre en una PC del autor: loguea al legacy con una cuenta-bot, pollea `apply-leave.php` cada ~2 min y, al detectar materias habilitadas, llama a `/api/webhooks/asistencia` (que hace el broadcast, idempotente por materia/día). El daemon manda un heartbeat con métricas cada 10s a `/api/asistencia/worker/heartbeat` (tabla `asistencia_workers`), que alimenta una sección en `/admin/dashboard`. Un `supervisor.mts` mantiene vivo al daemon y obedece comandos (reiniciar/frenar/arrancar) encolados como columnas en la fila del worker. Todo el patrón de monitor/supervisor es un calco del captcha worker ya mergeado en `main`.

**Tech Stack:** Next.js 16.2.6 App Router (route handlers, `runtime = "nodejs"`), Supabase REST vía `lib/supabase.ts:supabaseFetch`, `web-push` vía `lib/webPush.ts`, TypeScript nativo de Node 24 para los scripts `.mts` (`axios` + `cheerio` + `tough-cookie`), PowerShell para `start.ps1` / `install-tarea.ps1`.

**Spec:** `docs/superpowers/specs/2026-09-02-notificaciones-asistencia-daemon-design.md`

## Global Constraints

- **No hay suite de tests** (CLAUDE.md: "No test suite is configured"). La verificación de cada tarea es `npm run typecheck` + `npm run lint` + pasos manuales con salida esperada (curl / navegador). No agregar framework de tests.
- **Next 16.2.6 tiene breaking changes** (AGENTS.md): antes de escribir un route handler, leer la guía pertinente en `node_modules/next/dist/docs/`.
- **Route handlers nuevos:** `export const runtime = "nodejs";` y, en los que leen estado vivo, `export const dynamic = "force-dynamic";` (igual que `app/api/captcha/heartbeat/route.ts`).
- **Estilo iOS del proyecto:** colores como literales hex inline en JSX (`#007aff`, `#34c759`, `#ff3b30`, `#ff9500`), variables CSS `var(--fg)` / `var(--secondary)` / `var(--surface)` / `var(--separator)`, tarjetas `rounded-[20px]`. No usar tokens de color de Tailwind.
- **Secreto de los endpoints del worker:** header `x-worker-secret` validado contra `process.env.NOTIFICATIONS_WEBHOOK_SECRET` (ya está en Vercel; no crear env var nueva).
- **Scripts `.mts`:** se corren con `node archivo.mts` directo (Node 24 los soporta nativo). ESM: `import x from "..."`, nunca `require`.
- **Nombres de comando:** `reiniciar` | `frenar` | `arrancar` (no "parar"/"stop"/"restart"). Estado del worker: `activo` | `apagado`.
- **`WORKER_ID`** en la PC = `process.env.ASISTENCIA_WORKER_NAME || os.hostname()`, cortado a 80 chars.
- **Zona horaria para "hoy":** `America/Argentina/Buenos_Aires`.
- **Commits:** terminar el mensaje con `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## File Structure

**Supabase (SQL, se corren a mano en el editor de Supabase):**
- `scripts/asistencia-workers.sql` (nuevo) — tabla `asistencia_workers` (heartbeat + columnas de comando).
- `scripts/asistencia-avisos-log.sql` (nuevo) — tabla `asistencia_avisos_log` (dedup por materia/día).
- `scripts/notifications.sql` (editar) — anexar las dos tablas al consolidado.

**Route handlers:**
- `app/api/webhooks/asistencia/route.ts` (editar) — loop por materia + dedup + limpieza de nombre; deja de tocar `asistencia_agent_status`.
- `app/api/asistencia/notify/route.ts` (editar) — deja de tocar `asistencia_agent_status`.
- `app/api/asistencia/agent/route.ts` (borrar) — reemplazado por `worker/heartbeat`.
- `app/api/asistencia/worker/heartbeat/route.ts` (nuevo) — calco de `app/api/captcha/heartbeat/route.ts`.
- `app/api/asistencia/worker/comando/route.ts` (nuevo) — calco de `app/api/captcha/comando/route.ts`.
- `app/api/admin/asistencia-workers/route.ts` (nuevo) — calco de `app/api/admin/captcha-workers/route.ts`.
- `app/api/admin/asistencia-command/route.ts` (nuevo) — calco de `app/api/admin/captcha-command/route.ts`.
- `app/api/admin/notifications/test-send/route.ts` (nuevo) — envío de prueba a un email o a todos.

**UI admin:**
- `app/admin/dashboard/_components/AsistenciaWorkersSection.tsx` (nuevo) — calco de `CaptchaWorkersSection.tsx`.
- `app/admin/dashboard/_components/PushTestSection.tsx` (nuevo) — sección de envío de prueba.
- `app/admin/dashboard/_components/AdminDashboardClient.tsx` (editar) — monta las dos secciones; ajusta copy de "Simulador PWA".
- `app/admin/_components/AdminPanelClient.tsx` (editar) — quita `AgentStatus` y su fetch.

**Daemon (nuevo directorio `scripts/asistencia-daemon/`):**
- `metricas.mts` — singleton de métricas (calco de `lib/captchaMetricas.ts`).
- `daemon.mts` — porta `agent.js`: login legacy + poll + webhook + heartbeat.
- `supervisor.mts` — keep-alive del daemon + poll de comandos (calco de `scripts/captcha-remoto/supervisor.mts` sin túnel).
- `start.ps1` — setup + `$env:` + lanza `supervisor.mts` (calco de `scripts/captcha-remoto/start.ps1`).
- `install-tarea.ps1` — tarea `CampusAsistenciaWorker` (calco de `scripts/captcha-remoto/install-tarea.ps1`).
- `asistencia-worker.service` — unidad systemd (calco de `scripts/captcha-remoto/captcha-worker.service`).
- `README.md` — uso, mover a otra PC, auto-arranque.

**Otros:**
- `agent.js` (borrar) — reemplazado por `scripts/asistencia-daemon/daemon.mts`.
- `.gitignore` (editar) — ignorar los `*.txt` generados del daemon.

---

## Task 1: Esquema Supabase

**Files:**
- Create: `scripts/asistencia-workers.sql`
- Create: `scripts/asistencia-avisos-log.sql`
- Modify: `scripts/notifications.sql` (anexar al final)

**Interfaces:**
- Produces: tabla `asistencia_workers` con columnas `id, actualizado, proceso_desde, version, estado, motivo, ram_total_mb, ram_usada_mb, polls_total, errores, login_ok, ultimo_error, rt_ultimo_ms, rt_prom_ms, rt_max_ms, rt_min_ms, materias_hoy, pushes_hoy, comando, comando_nonce, comando_pedido, comando_ack, comando_por`.
- Produces: tabla `asistencia_avisos_log` con PK `(fecha, materia_id)` y columnas `materia_nombre, enviado_at, enviados`.

- [ ] **Step 1: Crear `scripts/asistencia-workers.sql`**

```sql
-- Monitor del daemon de asistencia (heartbeat cada ~10s).
-- Lo escribe /api/asistencia/worker/heartbeat; lo lee /admin/dashboard.
-- Mismo patrón que scripts/captcha-workers.sql (una fila por worker, los
-- comandos viven como columnas en la fila).

create table if not exists public.asistencia_workers (
  id             text primary key,          -- nombre del worker (-Name, default hostname)
  actualizado    timestamptz not null default now(),
  proceso_desde  timestamptz,
  version        text,                       -- git sha corto
  estado         text not null default 'activo',   -- 'activo' | 'apagado'
  motivo         text,                       -- por qué se apagó (si estado='apagado')
  ram_total_mb   integer not null default 0,
  ram_usada_mb   integer not null default 0,
  -- métricas propias del daemon:
  polls_total    integer not null default 0,
  errores        integer not null default 0,
  login_ok       boolean not null default false,
  ultimo_error   text,
  rt_ultimo_ms   integer not null default 0,   -- duración del GET a apply-leave.php
  rt_prom_ms     integer not null default 0,
  rt_max_ms      integer not null default 0,
  rt_min_ms      integer not null default 0,
  materias_hoy   text,                        -- CSV de nombres detectados hoy
  pushes_hoy     integer not null default 0,
  -- comandos remotos (mismas columnas que captcha_workers):
  comando        text,                        -- 'reiniciar' | 'frenar' | 'arrancar' | null
  comando_nonce  text,
  comando_pedido timestamptz,
  comando_ack    timestamptz,
  comando_por    text
);

create index if not exists asistencia_workers_actualizado_idx
  on public.asistencia_workers (actualizado desc);

-- Solo el service role (backend) toca esta tabla.
alter table public.asistencia_workers enable row level security;
```

- [ ] **Step 2: Crear `scripts/asistencia-avisos-log.sql`**

```sql
-- Anti-repetición del aviso de asistencia: una fila por (día, materia).
-- Lo escribe /api/webhooks/asistencia antes de mandar la push.

create table if not exists public.asistencia_avisos_log (
  fecha           date not null,
  materia_id      text not null,
  materia_nombre  text,
  enviado_at      timestamptz not null default now(),
  enviados        integer not null default 0,
  primary key (fecha, materia_id)
);

alter table public.asistencia_avisos_log enable row level security;
```

- [ ] **Step 3: Anexar ambas al consolidado**

Al final de `scripts/notifications.sql`, agregar:

```sql

-- ─────────────────────────────────────────────────────────────────────────────
-- Daemon de asistencia: monitor + anti-repetición
-- (ver scripts/asistencia-workers.sql y scripts/asistencia-avisos-log.sql)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asistencia_workers (
  id             TEXT PRIMARY KEY,
  actualizado    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  proceso_desde  TIMESTAMP WITH TIME ZONE,
  version        TEXT,
  estado         TEXT NOT NULL DEFAULT 'activo',
  motivo         TEXT,
  ram_total_mb   INTEGER NOT NULL DEFAULT 0,
  ram_usada_mb   INTEGER NOT NULL DEFAULT 0,
  polls_total    INTEGER NOT NULL DEFAULT 0,
  errores        INTEGER NOT NULL DEFAULT 0,
  login_ok       BOOLEAN NOT NULL DEFAULT FALSE,
  ultimo_error   TEXT,
  rt_ultimo_ms   INTEGER NOT NULL DEFAULT 0,
  rt_prom_ms     INTEGER NOT NULL DEFAULT 0,
  rt_max_ms      INTEGER NOT NULL DEFAULT 0,
  rt_min_ms      INTEGER NOT NULL DEFAULT 0,
  materias_hoy   TEXT,
  pushes_hoy     INTEGER NOT NULL DEFAULT 0,
  comando        TEXT,
  comando_nonce  TEXT,
  comando_pedido TIMESTAMP WITH TIME ZONE,
  comando_ack    TIMESTAMP WITH TIME ZONE,
  comando_por    TEXT
);

CREATE TABLE IF NOT EXISTS asistencia_avisos_log (
  fecha           DATE NOT NULL,
  materia_id      TEXT NOT NULL,
  materia_nombre  TEXT,
  enviado_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  enviados        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fecha, materia_id)
);
```

- [ ] **Step 4: Verificar**

Run: `npx prettier --check scripts/asistencia-workers.sql scripts/asistencia-avisos-log.sql` — si prettier no soporta `.sql` (probable), saltar. En su lugar, leer los tres archivos y confirmar: sin `;;` dobles, columnas de `asistencia_workers` idénticas entre `scripts/asistencia-workers.sql` y el bloque de `scripts/notifications.sql` (mismos nombres, mismo orden).
Expected: los nombres de columna coinciden 1:1 con los que consumen las Tasks 4 y 6.

- [ ] **Step 5: Commit**

```bash
git add scripts/asistencia-workers.sql scripts/asistencia-avisos-log.sql scripts/notifications.sql
git commit -m "$(printf 'feat(asistencia): schema del monitor de workers + anti-repeticion de avisos\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

> **Nota para quien ejecute:** estas tablas hay que correrlas a mano en Supabase → SQL Editor antes de probar las Tasks 2, 4 y 6. No hay migración automática en este repo.

---

## Task 2: `/api/webhooks/asistencia` — loop por materia + dedup

**Files:**
- Modify: `app/api/webhooks/asistencia/route.ts` (reescribe el handler)

**Interfaces:**
- Consumes: `supabaseFetch` de `@/lib/supabase`; `sendPushNotification(payload, excludeUserKeys?)` de `@/lib/webPush` (devuelve `{ total, sent, failed, errors? }`); tabla `asistencia_avisos_log` (Task 1).
- Produces: `POST /api/webhooks/asistencia` acepta `{ activeOptions: {id,name}[], materia?, source? }` con header `x-agent-secret` (o `x-notify-secret`) y responde `{ ok: true, materias: [{ materiaId, materia, enviado: boolean, sent?: number }] }`. Idempotente: la segunda llamada con la misma materia el mismo día responde `enviado: false`.

- [ ] **Step 1: Reescribir el archivo completo**

Reemplazar todo `app/api/webhooks/asistencia/route.ts` por:

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/webPush";

export const runtime = "nodejs";

type Opcion = { id: string; name: string };
type AsistenciaWebhookPayload = {
  materia?: string;
  source?: string;
  activeOptions?: Opcion[];
};

/** "ANÁLISIS MATEMÁTICO I - 2026 - ISI - 2008 - A" -> "ANÁLISIS MATEMÁTICO I" */
function limpiarNombreMateria(nombre: string): string {
  return nombre.replace(/\s*[-–]\s*\d{4}\b.*$/u, "").trim() || nombre.trim();
}

/** Fecha de hoy en Argentina, formato YYYY-MM-DD. */
function hoyArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** true si NO había fila para (fecha, materiaId) y la insertó ahora. */
async function reservarAviso(
  fecha: string,
  materiaId: string,
  materiaNombre: string
): Promise<boolean> {
  const yaRes = await supabaseFetch(
    `asistencia_avisos_log?select=materia_id&fecha=eq.${fecha}&materia_id=eq.${encodeURIComponent(materiaId)}`
  );
  if (yaRes.ok) {
    const filas = (await yaRes.json()) as unknown[];
    if (filas.length > 0) return false;
  }
  const insRes = await supabaseFetch("asistencia_avisos_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      fecha,
      materia_id: materiaId,
      materia_nombre: materiaNombre,
      enviados: 0,
    }),
  });
  // 201 = insertada; 409 = otro daemon la insertó en la carrera -> ya avisado.
  return insRes.ok;
}

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFICATIONS_WEBHOOK_SECRET ?? "";
  const provided =
    req.headers.get("x-agent-secret") ?? req.headers.get("x-notify-secret") ?? "";
  if (secret && secret !== provided) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => ({}))) as AsistenciaWebhookPayload;

  // Normalizar: aceptar el shape viejo { materia } suelto.
  let opciones: Opcion[] = Array.isArray(payload.activeOptions)
    ? payload.activeOptions.filter((o) => o && o.id && o.name)
    : [];
  if (opciones.length === 0 && payload.materia) {
    opciones = [{ id: payload.materia, name: payload.materia }];
  }
  if (opciones.length === 0) {
    return NextResponse.json({ ok: true, materias: [] });
  }

  // Usuarios que desactivaron los avisos de asistencia (o el global) — se excluyen.
  const disabledRes = await supabaseFetch(
    "perfil_notificaciones?or=(notificaciones_globales_activas.eq.false,notificar_asistencia.eq.false)&select=email"
  );
  const excludeUserKeys = disabledRes.ok
    ? new Set(((await disabledRes.json()) as { email: string }[]).map((r) => r.email))
    : undefined;

  const fecha = hoyArgentina();
  const materias: { materiaId: string; materia: string; enviado: boolean; sent?: number }[] = [];

  for (const opcion of opciones) {
    const nombre = limpiarNombreMateria(opcion.name);
    const nuevo = await reservarAviso(fecha, opcion.id, nombre);
    if (!nuevo) {
      materias.push({ materiaId: opcion.id, materia: nombre, enviado: false });
      continue;
    }

    const result = await sendPushNotification(
      {
        title: "¡La asistencia está abierta!",
        body: `Ya podés marcar asistencia en ${nombre}.`,
        url: "/asistencia",
        tag: `asistencia-${opcion.id}`,
      },
      excludeUserKeys
    );

    await supabaseFetch(
      `asistencia_avisos_log?fecha=eq.${fecha}&materia_id=eq.${encodeURIComponent(opcion.id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ enviados: result.sent }),
      }
    ).catch(() => {});

    materias.push({ materiaId: opcion.id, materia: nombre, enviado: true, sent: result.sent });
  }

  return NextResponse.json({ ok: true, materias });
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS, sin errores nuevos.

- [ ] **Step 3: Verificar dedup con curl**

Con `npm run dev` corriendo y `NOTIFICATIONS_WEBHOOK_SECRET` en `.env.local` (leerlo de ahí; si no está, exportar uno temporal y reiniciar dev):

```bash
SECRET=$(grep -E '^NOTIFICATIONS_WEBHOOK_SECRET=' .env.local | cut -d= -f2-)
curl -s -X POST http://localhost:3000/api/webhooks/asistencia \
  -H "content-type: application/json" -H "x-agent-secret: $SECRET" \
  -d '{"activeOptions":[{"id":"TEST1","name":"MATERIA DE PRUEBA - 2026 - ISI - A"}]}'
echo
curl -s -X POST http://localhost:3000/api/webhooks/asistencia \
  -H "content-type: application/json" -H "x-agent-secret: $SECRET" \
  -d '{"activeOptions":[{"id":"TEST1","name":"MATERIA DE PRUEBA - 2026 - ISI - A"}]}'
```

Expected:
- 1ª respuesta: `{"ok":true,"materias":[{"materiaId":"TEST1","materia":"MATERIA DE PRUEBA","enviado":true,"sent":N}]}` (N = suscripciones activas, puede ser 0).
- 2ª respuesta: `{"ok":true,"materias":[{"materiaId":"TEST1","materia":"MATERIA DE PRUEBA","enviado":false}]}`.
- En Supabase → `asistencia_avisos_log` hay una fila `(hoy, TEST1)`.

- [ ] **Step 4: Verificar dos materias a la vez**

```bash
curl -s -X POST http://localhost:3000/api/webhooks/asistencia \
  -H "content-type: application/json" -H "x-agent-secret: $SECRET" \
  -d '{"activeOptions":[{"id":"TEST2","name":"REDES - 2026 - ISI - B"},{"id":"TEST3","name":"FISICA II - 2026 - ISI - A"}]}'
```

Expected: `materias` con dos entradas `enviado:true`. Dos filas nuevas en `asistencia_avisos_log`.
Limpiar: borrar las filas `TEST1..TEST3` de `asistencia_avisos_log` en Supabase.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/asistencia/route.ts
git commit -m "$(printf 'feat(asistencia): webhook idempotente por materia/dia + limpieza de nombre\n\nUn aviso por (dia, materia). Soporta varias materias abiertas a la vez.\nDeja de escribir asistencia_agent_status (se retira en otra tarea).\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

## Task 3: Envío de prueba desde `/admin/dashboard`

**Files:**
- Create: `app/api/admin/notifications/test-send/route.ts`
- Create: `app/admin/dashboard/_components/PushTestSection.tsx`
- Modify: `app/admin/dashboard/_components/AdminDashboardClient.tsx`

**Interfaces:**
- Consumes: `isAdminRequest` de `@/lib/adminAuth`; `sendPushNotification(payload)` y `sendPushToUser(userKey, payload)` de `@/lib/webPush` (ambas devuelven `{ total, sent, failed, errors? }`).
- Produces: `POST /api/admin/notifications/test-send` body `{ target: "all" | "email", email?: string }` → `{ ok, total, sent, failed, errors? }` o `{ error }` con 4xx.

- [ ] **Step 1: Crear el route handler**

`app/api/admin/notifications/test-send/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { sendPushNotification, sendPushToUser } from "@/lib/webPush";

export const runtime = "nodejs";

const PAYLOAD = {
  title: "🔔 Prueba — Campus UTN",
  body: "Notificación de prueba. Si la ves, las push están funcionando.",
  url: "/asistencia",
  icon: "/logo.png",
};

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { target?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const payload = { ...PAYLOAD, tag: `test-${Date.now()}` }; // tag único => siempre aparece

  if (body.target === "email") {
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "Falta el email" }, { status: 400 });
    }
    const result = await sendPushToUser(email, payload);
    if (result.total === 0) {
      return NextResponse.json(
        { error: "Ese usuario no tiene suscripciones push activas" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, ...result });
  }

  if (body.target === "all") {
    const result = await sendPushNotification(payload);
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "target debe ser 'all' o 'email'" }, { status: 400 });
}
```

- [ ] **Step 2: Crear la sección de UI**

`app/admin/dashboard/_components/PushTestSection.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Bell, Loader2, CheckCircle2, XCircle } from "lucide-react";

type Estado = "idle" | "loading" | "ok" | "error";
type Resultado = { total: number; sent: number; failed: number; error?: string } | null;

export default function PushTestSection() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<Estado>("idle");
  const [res, setRes] = useState<Resultado>(null);

  async function enviar(target: "email" | "all") {
    if (target === "all" && !window.confirm("Mandar una push de prueba a TODOS los dispositivos registrados?")) {
      return;
    }
    setEstado("loading");
    setRes(null);
    try {
      const r = await fetch("/api/admin/notifications/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target === "email" ? { target, email } : { target }),
      });
      const j = await r.json().catch(() => ({}));
      setRes(j);
      setEstado(r.ok && (j.failed ?? 0) === 0 ? "ok" : "error");
    } catch {
      setEstado("error");
      setRes({ total: 0, sent: 0, failed: 0, error: "No se pudo llamar al endpoint" });
    } finally {
      setTimeout(() => setEstado("idle"), 4000);
    }
  }

  const Icono = estado === "loading" ? Loader2 : estado === "ok" ? CheckCircle2 : estado === "error" ? XCircle : Bell;

  return (
    <section className="mb-7">
      <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
        Notificaciones push — prueba
      </p>

      <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--separator)]">
          <Icono
            className={`h-[18px] w-[18px] ${estado === "loading" ? "animate-spin" : ""}`}
            style={{
              color: estado === "ok" ? "#34c759" : estado === "error" ? "#ff3b30" : "var(--secondary)",
            }}
          />
          <span className="text-[14px] text-[var(--secondary)]">
            Manda una push real a los dispositivos elegidos.
          </span>
        </div>

        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
          <input
            type="email"
            inputMode="email"
            placeholder="email del usuario"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-[12px] border border-[var(--separator)] bg-transparent px-3 py-2 text-[15px] text-[var(--fg)] outline-none focus:border-[#007aff]"
          />
          <button
            type="button"
            disabled={estado === "loading" || !email.trim()}
            onClick={() => enviar("email")}
            className="rounded-[12px] px-3 py-2 text-[14px] font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: "#007aff" }}
          >
            Enviar a este usuario
          </button>
        </div>

        <div className="px-4 pb-3">
          <button
            type="button"
            disabled={estado === "loading"}
            onClick={() => enviar("all")}
            className="rounded-[12px] border px-3 py-2 text-[14px] font-medium disabled:opacity-40"
            style={{ borderColor: "#ff3b30", color: "#ff3b30" }}
          >
            Enviar a todos
          </button>
        </div>

        {res && (
          <div className="border-t border-[var(--separator)] px-4 py-3 text-[13px]">
            {res.error ? (
              <p style={{ color: "#ff3b30" }}>{res.error}</p>
            ) : (
              <p className="text-[var(--secondary)]">
                Total <b className="text-[var(--fg)]">{res.total}</b> · OK{" "}
                <b style={{ color: "#34c759" }}>{res.sent}</b> · fallidas{" "}
                <b style={{ color: "#ff3b30" }}>{res.failed}</b>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Montar la sección en el dashboard**

En `app/admin/dashboard/_components/AdminDashboardClient.tsx`:

1. Agregar el import junto a los otros de `./`:
   ```tsx
   import PushTestSection from "./PushTestSection";
   ```
2. Debajo de `<CaptchaWorkersSection />`, agregar:
   ```tsx
   <PushTestSection />
   ```
3. En el array `TOOLS`, cambiar la `description` de "Simulador PWA" de
   `"Disparar notificaciones push y ver el agente de asistencia"` a
   `"Disparar notificaciones push de prueba a tus propios dispositivos"`.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Verificar en el navegador**

Con `npm run dev`, loguearse en `/admin/login`, ir a `/admin/dashboard`:
- La sección "Notificaciones push — prueba" aparece debajo de "Captcha remoto — workers".
- "Enviar a este usuario" con un email inexistente → aparece "Ese usuario no tiene suscripciones push activas" en rojo.
- (Si hay una suscripción propia activa) "Enviar a este usuario" con el propio email → llega la push al dispositivo y el resultado muestra `OK 1`.

Expected: los tres comportamientos.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/notifications/test-send/route.ts app/admin/dashboard/_components/PushTestSection.tsx app/admin/dashboard/_components/AdminDashboardClient.tsx
git commit -m "$(printf 'feat(admin): enviar push de prueba a un email o a todos desde el dashboard\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

## Task 4: Endpoints del worker de asistencia (heartbeat + comando + admin)

**Files:**
- Create: `app/api/asistencia/worker/heartbeat/route.ts`
- Create: `app/api/asistencia/worker/comando/route.ts`
- Create: `app/api/admin/asistencia-workers/route.ts`
- Create: `app/api/admin/asistencia-command/route.ts`

**Interfaces:**
- Consumes: `supabaseFetch` de `@/lib/supabase`; `isAdminRequest` de `@/lib/adminAuth`; tabla `asistencia_workers` (Task 1); `process.env.NOTIFICATIONS_WEBHOOK_SECRET`.
- Produces:
  - `POST /api/asistencia/worker/heartbeat` — header `x-worker-secret`, body `{ id, estado?, motivo?, proceso_desde?, version?, ram_total_mb?, ram_usada_mb?, polls_total?, errores?, login_ok?, ultimo_error?, rt_ultimo_ms?, rt_prom_ms?, rt_max_ms?, rt_min_ms?, materias_hoy?, pushes_hoy? }` → `{ ok: true }`. Upsert por `id`.
  - `GET /api/asistencia/worker/comando?id=X` — header `x-worker-secret` → `{ cmd, nonce }` si hay comando sin ack, si no `{ cmd: null }`.
  - `POST /api/asistencia/worker/comando` — header `x-worker-secret`, body `{ id, nonce }` → marca `comando_ack`.
  - `GET /api/admin/asistencia-workers` — cookie admin → `{ workers: Worker[], ahora }` donde cada `Worker` es la fila + `hace_ms`, `activa_hace_ms`, `conectada`, `comando_vencido`.
  - `POST /api/admin/asistencia-command` — cookie admin, body `{ id, cmd: "reiniciar"|"frenar"|"arrancar" }` → `{ ok: true, nonce }`.

- [ ] **Step 1: `heartbeat` (calco de `app/api/captcha/heartbeat/route.ts`)**

`app/api/asistencia/worker/heartbeat/route.ts`:

```ts
// Recibe el heartbeat del daemon de asistencia (scripts/asistencia-daemon/
// daemon.mts) y lo upsertea en Supabase (asistencia_workers). Lo lee
// /admin/dashboard. Calco de app/api/captcha/heartbeat/route.ts.

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
};

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFICATIONS_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-worker-secret") !== secret) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }
  const id = String(b.id || "").slice(0, 80);
  if (!id) return NextResponse.json({ error: "falta id" }, { status: 400 });

  const fila = {
    id,
    actualizado: new Date().toISOString(),
    proceso_desde: b.proceso_desde ? String(b.proceso_desde) : null,
    version: b.version ? String(b.version).slice(0, 40) : null,
    estado: b.estado === "apagado" ? "apagado" : "activo",
    motivo: b.motivo ? String(b.motivo).slice(0, 200) : null,
    ram_total_mb: n(b.ram_total_mb),
    ram_usada_mb: n(b.ram_usada_mb),
    polls_total: n(b.polls_total),
    errores: n(b.errores),
    login_ok: b.login_ok === true,
    ultimo_error: b.ultimo_error ? String(b.ultimo_error).slice(0, 300) : null,
    rt_ultimo_ms: n(b.rt_ultimo_ms),
    rt_prom_ms: n(b.rt_prom_ms),
    rt_max_ms: n(b.rt_max_ms),
    rt_min_ms: n(b.rt_min_ms),
    materias_hoy: b.materias_hoy ? String(b.materias_hoy).slice(0, 500) : null,
    pushes_hoy: n(b.pushes_hoy),
  };

  try {
    const res = await supabaseFetch("asistencia_workers?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(fila),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "supabase", detalle: (await res.text()).slice(0, 200) },
        { status: 502 }
      );
    }
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: `comando` (calco exacto de `app/api/captcha/comando/route.ts`)**

`app/api/asistencia/worker/comando/route.ts` — copiar `app/api/captcha/comando/route.ts` y aplicar estos reemplazos textuales:
- `captcha_workers` → `asistencia_workers`
- `CAPTCHA_HEARTBEAT_SECRET` → `NOTIFICATIONS_WEBHOOK_SECRET`
- el comentario del encabezado: cambiar `/api/captcha/comando` → `/api/asistencia/worker/comando` y `= CAPTCHA_HEARTBEAT_SECRET` → `= NOTIFICATIONS_WEBHOOK_SECRET`

Resultado esperado (para verificar):

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function autorizado(req: NextRequest): boolean {
  const s = process.env.NOTIFICATIONS_WEBHOOK_SECRET;
  return !!s && req.headers.get("x-worker-secret") === s;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "no" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id")?.slice(0, 80) || "";
  if (!id) return NextResponse.json({ error: "falta id" }, { status: 400 });
  try {
    const res = await supabaseFetch(
      `asistencia_workers?select=comando,comando_nonce,comando_ack&id=eq.${encodeURIComponent(id)}`,
      { method: "GET" }
    );
    const rows = res.ok ? ((await res.json()) as Array<Record<string, unknown>>) : [];
    const r = rows[0];
    if (r && r.comando && !r.comando_ack) {
      return NextResponse.json({ cmd: r.comando, nonce: r.comando_nonce });
    }
    return NextResponse.json({ cmd: null });
  } catch {
    return NextResponse.json({ cmd: null });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "no" }, { status: 401 });
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "body" }, { status: 400 });
  }
  const id = String(b.id || "").slice(0, 80);
  const nonce = String(b.nonce || "").slice(0, 64);
  if (!id || !nonce) return NextResponse.json({ error: "falta id/nonce" }, { status: 400 });
  try {
    await supabaseFetch(
      `asistencia_workers?id=eq.${encodeURIComponent(id)}&comando_nonce=eq.${encodeURIComponent(nonce)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ comando_ack: new Date().toISOString() }),
      }
    );
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `admin/asistencia-workers` (calco de `app/api/admin/captcha-workers/route.ts`)**

`app/api/admin/asistencia-workers/route.ts`:

```ts
// Monitor del daemon de asistencia para /admin/dashboard.
// Calco de app/api/admin/captcha-workers/route.ts.

import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONECTADA_MS = 30000;

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  let rows: Array<Record<string, unknown>> = [];
  try {
    const res = await supabaseFetch(
      "asistencia_workers?select=*&order=actualizado.desc",
      { method: "GET" }
    );
    if (res.ok) rows = await res.json();
  } catch {
    /* lista vacía */
  }
  const ahora = Date.now();
  const workers = rows.map((r) => {
    const haceMs = ahora - new Date(String(r.actualizado)).getTime();
    const desde = r.proceso_desde ? new Date(String(r.proceso_desde)).getTime() : 0;
    const pedido = r.comando_pedido ? new Date(String(r.comando_pedido)).getTime() : 0;
    return {
      ...r,
      hace_ms: haceMs,
      activa_hace_ms: desde ? ahora - desde : null,
      conectada: r.estado === "activo" && haceMs < CONECTADA_MS,
      comando_vencido: !!r.comando && !r.comando_ack && pedido > 0 && ahora - pedido > 90000,
    };
  });
  return NextResponse.json({ workers, ahora: new Date(ahora).toISOString() });
}
```

- [ ] **Step 4: `admin/asistencia-command` (calco de `app/api/admin/captcha-command/route.ts`)**

`app/api/admin/asistencia-command/route.ts`:

```ts
// El admin encola un comando para el supervisor del daemon de asistencia.
// Calco de app/api/admin/captcha-command/route.ts.

import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALIDOS = new Set(["reiniciar", "frenar", "arrancar"]);

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }
  const id = String(b.id || "").slice(0, 80);
  const cmd = String(b.cmd || "");
  if (!id || !VALIDOS.has(cmd)) {
    return NextResponse.json({ error: "id o cmd inválido" }, { status: 400 });
  }
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    const res = await supabaseFetch(`asistencia_workers?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        comando: cmd,
        comando_nonce: nonce,
        comando_pedido: new Date().toISOString(),
        comando_ack: null,
        comando_por: "admin",
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: (await res.text()).slice(0, 200) }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, nonce });
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Verificar con curl**

Con `npm run dev` y `SECRET` como en Task 2, y la tabla `asistencia_workers` creada en Supabase:

```bash
# heartbeat inserta la fila
curl -s -X POST http://localhost:3000/api/asistencia/worker/heartbeat \
  -H "content-type: application/json" -H "x-worker-secret: $SECRET" \
  -d '{"id":"pc-test","estado":"activo","proceso_desde":"2026-09-03T12:00:00Z","version":"abc1234","polls_total":3,"rt_ultimo_ms":420,"login_ok":true}'
# -> {"ok":true}

# sin secret -> 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/asistencia/worker/heartbeat -d '{}'
# -> 401

# comando sin encolar -> cmd null
curl -s "http://localhost:3000/api/asistencia/worker/comando?id=pc-test" -H "x-worker-secret: $SECRET"
# -> {"cmd":null}
```

Verificar en Supabase que `asistencia_workers` tiene la fila `pc-test` con `polls_total = 3`.
Para probar `admin/*` hace falta la cookie de admin — se verifica end-to-end en la Task 5.
Limpiar: borrar la fila `pc-test`.

- [ ] **Step 7: Commit**

```bash
git add app/api/asistencia/worker app/api/admin/asistencia-workers app/api/admin/asistencia-command
git commit -m "$(printf 'feat(asistencia): endpoints worker/heartbeat + worker/comando + admin (calco de captcha)\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

## Task 5: Sección del monitor en el dashboard + retiro de `asistencia_agent_status`

**Files:**
- Create: `app/admin/dashboard/_components/AsistenciaWorkersSection.tsx`
- Modify: `app/admin/dashboard/_components/AdminDashboardClient.tsx`
- Modify: `app/admin/_components/AdminPanelClient.tsx`
- Modify: `app/api/asistencia/notify/route.ts`
- Delete: `app/api/asistencia/agent/route.ts`

**Interfaces:**
- Consumes: `GET /api/admin/asistencia-workers` (Task 4) → `{ workers, ahora }`; `POST /api/admin/asistencia-command` (Task 4).
- Produces: componente `AsistenciaWorkersSection` (default export) montado en `AdminDashboardClient`.

- [ ] **Step 1: Crear `AsistenciaWorkersSection.tsx` (calco de `CaptchaWorkersSection.tsx`)**

`app/admin/dashboard/_components/AsistenciaWorkersSection.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Radio, RotateCw, Square, Play } from "lucide-react";

type Worker = {
  id: string;
  actualizado: string;
  proceso_desde: string | null;
  version: string | null;
  estado: string;
  motivo: string | null;
  ram_total_mb: number;
  ram_usada_mb: number;
  polls_total: number;
  errores: number;
  login_ok: boolean;
  ultimo_error: string | null;
  rt_ultimo_ms: number;
  rt_prom_ms: number;
  rt_max_ms: number;
  rt_min_ms: number;
  materias_hoy: string | null;
  pushes_hoy: number;
  hace_ms: number;
  activa_hace_ms: number | null;
  conectada: boolean;
  comando: string | null;
  comando_ack: string | null;
  comando_vencido: boolean;
};

function dur(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const ms = (v: number) => (v ? `${v} ms` : "—");

function Dato({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-[var(--secondary)]">{k}</span>
      <span className="text-[14px] font-semibold text-[var(--fg)] tabular-nums">{v}</span>
    </div>
  );
}

function RamDato({ total, usada }: { total: number; usada: number }) {
  if (!total) return <Dato k="RAM de la PC" v="—" />;
  const pct = Math.min(100, Math.round((usada / total) * 100));
  const color = pct >= 88 ? "#ff3b30" : pct >= 70 ? "#ff9500" : "#34c759";
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-[var(--secondary)]">RAM de la PC</span>
      <span className="text-[14px] font-semibold text-[var(--fg)] tabular-nums">
        {(usada / 1024).toFixed(1)} / {(total / 1024).toFixed(1)} GB
      </span>
      <span className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--separator)]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
    </div>
  );
}

/** Monitor de las PCs que corren el daemon de asistencia. */
export default function AsistenciaWorkersSection() {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);

  async function mandarComando(id: string, cmd: "reiniciar" | "frenar" | "arrancar") {
    setEnviando(id + cmd);
    try {
      await fetch("/api/admin/asistencia-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, cmd }),
      });
    } catch {
      /* el estado se ve en el próximo poll */
    } finally {
      setEnviando(null);
    }
  }

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const r = await fetch("/api/admin/asistencia-workers", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { workers: Worker[] };
        if (vivo) {
          setWorkers(j.workers);
          setErr(null);
        }
      } catch (e) {
        if (vivo) setErr(String((e as Error).message || e));
      }
    };
    cargar();
    const t = setInterval(cargar, 5000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  return (
    <section className="mb-7">
      <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
        Daemon de asistencia — workers
      </p>

      <div className="space-y-3">
        {err && <p className="px-4 text-[13px] text-[#ff3b30]">No se pudo leer el monitor: {err}</p>}

        {workers && workers.length === 0 && (
          <div className="rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] px-4 py-6 text-center">
            <Radio className="mx-auto h-6 w-6 text-[var(--secondary)]" />
            <p className="mt-2 text-[13px] text-[var(--secondary)]">
              Ningún worker reportó todavía. Iniciá <code>scripts/asistencia-daemon/start.ps1</code>{" "}
              con <code>-AppUrl</code> y <code>NOTIFICATIONS_WEBHOOK_SECRET</code> configurado.
            </p>
          </div>
        )}

        {workers?.map((w) => {
          const online = w.conectada;
          return (
            <div
              key={w.id}
              className="overflow-hidden rounded-[20px] border bg-[var(--surface)] shadow-sm"
              style={{ borderColor: online ? "rgba(52,199,89,0.35)" : "rgba(255,59,48,0.3)" }}
            >
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--separator)]">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: online ? "#34c759" : "#ff3b30" }}
                />
                <span className="text-[15px] font-semibold text-[var(--fg)] truncate">{w.id}</span>
                <span
                  className="ml-auto text-[12px] font-medium"
                  style={{ color: online ? "#34c759" : "#ff3b30" }}
                >
                  {online ? "conectada" : "desconectada"}
                </span>
              </div>

              <div className="px-4 py-3 grid grid-cols-3 gap-x-3 gap-y-3 md:grid-cols-4">
                <Dato k="Activa hace" v={online && w.activa_hace_ms != null ? dur(w.activa_hace_ms) : "—"} />
                <Dato k="Última señal" v={`hace ${dur(w.hace_ms)}`} />
                <RamDato total={w.ram_total_mb} usada={w.ram_usada_mb} />

                <Dato k="Polls" v={w.polls_total} />
                <Dato k="Errores" v={w.errores} />
                <Dato
                  k="Login legacy"
                  v={<span style={{ color: w.login_ok ? "#34c759" : "#ff3b30" }}>{w.login_ok ? "OK" : "fallando"}</span>}
                />

                <Dato k="RT último" v={ms(w.rt_ultimo_ms)} />
                <Dato k="RT promedio" v={ms(w.rt_prom_ms)} />
                <Dato k="RT mín / máx" v={`${ms(w.rt_min_ms)} / ${ms(w.rt_max_ms)}`} />

                <Dato k="Materias hoy" v={w.materias_hoy || "—"} />
                <Dato k="Pushes hoy" v={w.pushes_hoy} />
              </div>

              {!online && (
                <div className="px-4 py-2.5 border-t border-[var(--separator)] bg-[rgba(255,59,48,0.06)]">
                  <p className="text-[12px] text-[#ff3b30]">
                    {w.estado === "apagado" && w.motivo
                      ? `Apagada: ${w.motivo}`
                      : `Sin señal desde ${new Date(w.actualizado).toLocaleTimeString("es-AR")} — PC apagada, sin internet, o el script se cerró.`}
                  </p>
                </div>
              )}

              {w.ultimo_error && (
                <div className="px-4 py-1.5 border-t border-[var(--separator)]">
                  <p className="text-[11px] text-[var(--secondary)] truncate">último error: {w.ultimo_error}</p>
                </div>
              )}

              <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--separator)]">
                {(
                  [
                    ["reiniciar", "Reiniciar", RotateCw, "#007aff"],
                    ["frenar", "Frenar", Square, "#ff3b30"],
                    ["arrancar", "Arrancar", Play, "#34c759"],
                  ] as const
                ).map(([cmd, label, Icon, color]) => (
                  <button
                    key={cmd}
                    type="button"
                    disabled={enviando === w.id + cmd}
                    onClick={() => mandarComando(w.id, cmd)}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--separator)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--fg)] transition-colors active:bg-black/5 disabled:opacity-40 dark:active:bg-white/5"
                  >
                    <Icon className="h-[13px] w-[13px]" style={{ color }} />
                    {label}
                  </button>
                ))}
                {w.comando && (
                  <span className="ml-auto text-[11px] text-[var(--secondary)]">
                    {w.comando}
                    {w.comando_ack ? " · confirmado ✓" : w.comando_vencido ? " · sin respuesta" : " · pendiente…"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Montar en `AdminDashboardClient.tsx`**

En `app/admin/dashboard/_components/AdminDashboardClient.tsx`:
1. Import junto a los de `./`:
   ```tsx
   import AsistenciaWorkersSection from "./AsistenciaWorkersSection";
   ```
2. Inmediatamente **después** de `<CaptchaWorkersSection />` y **antes** de `<PushTestSection />`:
   ```tsx
   <AsistenciaWorkersSection />
   ```

- [ ] **Step 3: Quitar `AgentStatus` de `AdminPanelClient.tsx`**

En `app/admin/_components/AdminPanelClient.tsx`:
1. Borrar el componente `AgentStatus` completo y el helper `agentFetcher` y el `type AgentState` y `formatRelative` **si no se usan en otro lado** (verificar con búsqueda: `formatRelative` sólo lo usa `AgentStatus`).
2. Borrar el bloque JSX que lo renderiza:
   ```tsx
   <section className="mb-7">
     <p className="...">Agente de asistencia</p>
     <AgentStatus />
   </section>
   ```
3. Quitar de los imports de `lucide-react` los íconos que quedaron sin uso (`Radio`, `WifiOff`, `Clock3` — verificar cada uno con búsqueda en el archivo antes de borrar).
4. Quitar el import de `useSWR` si ya no se usa en el archivo (buscar `useSWR(` — si no hay más, borrar la línea `import useSWR from "swr";`).

- [ ] **Step 4: `notify` deja de tocar `asistencia_agent_status`**

En `app/api/asistencia/notify/route.ts`, borrar el bloque completo:

```ts
  // Actualizar el estado del agente para reflejar el disparo manual.
  await supabaseFetch("asistencia_agent_status?agent_id=eq.motorola-local", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "detected",
      last_seen_at: new Date().toISOString(),
      last_payload: { source: "admin-manual", materia: materia ?? null },
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => {});
```

Si tras borrarlo `supabaseFetch` ya no se usa en el archivo, quitar también su import.

- [ ] **Step 5: Borrar `app/api/asistencia/agent/route.ts`**

```bash
git rm app/api/asistencia/agent/route.ts
```

Buscar referencias muertas: `grep -rn "asistencia/agent\|asistencia_agent_status\|motorola-local" app/ components/ lib/`. Debe quedar **sin resultados** (fuera de `.waylog/` y `scripts/`).

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS, sin imports sin usar.

- [ ] **Step 7: Verificar end-to-end en el navegador**

Con `npm run dev`, tabla `asistencia_workers` creada, y logueado en `/admin/dashboard`:
1. Simular un worker:
   ```bash
   curl -s -X POST http://localhost:3000/api/asistencia/worker/heartbeat \
     -H "content-type: application/json" -H "x-worker-secret: $SECRET" \
     -d '{"id":"pc-test","estado":"activo","proceso_desde":"'"$(date -u +%FT%TZ)"'","version":"abc1234","polls_total":5,"rt_ultimo_ms":410,"rt_prom_ms":390,"rt_min_ms":300,"rt_max_ms":500,"login_ok":true,"ram_total_mb":16000,"ram_usada_mb":9000,"materias_hoy":"REDES","pushes_hoy":2}'
   ```
2. En "Daemon de asistencia — workers" aparece la tarjeta `pc-test` **conectada**, "Activa hace Ns", RAM con barra, Polls 5, Login legacy OK, RT, Materias hoy REDES, Pushes hoy 2.
3. Click "Reiniciar" → en Supabase la fila `pc-test` tiene `comando='reiniciar'`, `comando_nonce` seteado, `comando_ack` null; la etiqueta muestra "reiniciar · pendiente…".
4. Simular ACK:
   ```bash
   NONCE=$(curl -s "http://localhost:3000/api/asistencia/worker/comando?id=pc-test" -H "x-worker-secret: $SECRET" | sed -E 's/.*"nonce":"([^"]+)".*/\1/')
   curl -s -X POST http://localhost:3000/api/asistencia/worker/comando -H "content-type: application/json" -H "x-worker-secret: $SECRET" -d "{\"id\":\"pc-test\",\"nonce\":\"$NONCE\"}"
   ```
   La etiqueta pasa a "reiniciar · confirmado ✓" en ≤5s.
5. Esperar 35s sin más heartbeats → la tarjeta pasa a **desconectada** con "Sin señal desde HH:MM".
6. Ir a `/admin/testnotis` → ya **no** aparece la card "Dispositivo Local" / "Agente de asistencia"; el resto del panel sigue funcionando.

Limpiar: borrar la fila `pc-test` de `asistencia_workers`.

- [ ] **Step 8: Commit**

```bash
git add app/admin/dashboard/_components app/admin/_components/AdminPanelClient.tsx app/api/asistencia/notify/route.ts
git rm app/api/asistencia/agent/route.ts
git commit -m "$(printf 'feat(admin): monitor del daemon de asistencia en el dashboard; retira asistencia_agent_status\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

## Task 6: Daemon — `metricas.mts` + `daemon.mts`

**Files:**
- Create: `scripts/asistencia-daemon/metricas.mts`
- Create: `scripts/asistencia-daemon/daemon.mts`
- Delete: `agent.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `POST {CAMPUS_APP_URL}/api/webhooks/asistencia` (Task 2, header `x-agent-secret`); `POST {CAMPUS_APP_URL}/api/asistencia/worker/heartbeat` (Task 4, header `x-worker-secret`).
- Produces: `metricas` singleton con `.registrarRt(ms)`, `.registrarError(msg)`, `.registrarPoll()`, `.setLoginOk(bool)`, `.agregarMateria(nombre)`, `.sumarPushes(n)`, `.snapshot()`; ejecutable `node scripts/asistencia-daemon/daemon.mts`.

- [ ] **Step 1: Crear `metricas.mts` (calco de `lib/captchaMetricas.ts`)**

`scripts/asistencia-daemon/metricas.mts`:

```ts
// Métricas del daemon de asistencia. Singleton en memoria del proceso.
// Se serializa con snapshot() y va en el heartbeat cada ~10s.
// Adaptado de lib/captchaMetricas.ts (poll en vez de conexiones).

import fs from "node:fs";
import os from "node:os";

const VENTANA_RT = 50;

/** RAM de la PC (no del proceso). Copiado de lib/captchaMetricas.ts. */
function ramHost(): { total: number; usada: number } {
  try {
    const t = fs.readFileSync("/proc/meminfo", "utf8");
    const kb = (k: string) => Number(t.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] || 0);
    const total = kb("MemTotal");
    const disp = kb("MemAvailable") || kb("MemFree");
    if (total) {
      return { total: Math.round(total / 1024), usada: Math.round((total - disp) / 1024) };
    }
  } catch {
    /* no es Linux */
  }
  const total = Math.round(os.totalmem() / 1048576);
  return { total, usada: total - Math.round(os.freemem() / 1048576) };
}

/** YYYY-MM-DD en Argentina. */
function hoyArg(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

class MetricasAsistencia {
  readonly procesoDesde = Date.now();
  version = process.env.ASISTENCIA_WORKER_VERSION || "";

  pollsTotal = 0;
  errores = 0;
  loginOk = false;
  ultimoError = "";
  pushesHoy = 0;

  private rts: number[] = [];
  private dia = hoyArg();
  private materiasHoy = new Set<string>();

  private rolarDia(): void {
    const h = hoyArg();
    if (h !== this.dia) {
      this.dia = h;
      this.materiasHoy.clear();
      this.pushesHoy = 0;
    }
  }

  registrarPoll(): void {
    this.rolarDia();
    this.pollsTotal++;
  }

  registrarRt(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.rts.push(Math.round(ms));
    if (this.rts.length > VENTANA_RT) this.rts.shift();
  }

  registrarError(mensaje: string): void {
    this.errores++;
    this.ultimoError = mensaje.slice(0, 300);
  }

  setLoginOk(v: boolean): void {
    this.loginOk = v;
  }

  agregarMateria(nombre: string): void {
    this.rolarDia();
    this.materiasHoy.add(nombre);
  }

  sumarPushes(n: number): void {
    this.rolarDia();
    this.pushesHoy += Math.max(0, n);
  }

  snapshot(): Record<string, unknown> {
    const rts = this.rts;
    const prom = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0;
    const ram = ramHost();
    return {
      proceso_desde: new Date(this.procesoDesde).toISOString(),
      version: this.version,
      ram_total_mb: ram.total,
      ram_usada_mb: ram.usada,
      polls_total: this.pollsTotal,
      errores: this.errores,
      login_ok: this.loginOk,
      ultimo_error: this.ultimoError || null,
      rt_ultimo_ms: rts.at(-1) ?? 0,
      rt_prom_ms: prom,
      rt_max_ms: rts.length ? Math.max(...rts) : 0,
      rt_min_ms: rts.length ? Math.min(...rts) : 0,
      materias_hoy: [...this.materiasHoy].join(", ") || null,
      pushes_hoy: this.pushesHoy,
    };
  }
}

export const metricas = new MetricasAsistencia();
```

- [ ] **Step 2: Crear `daemon.mts` (porta `agent.js`)**

`scripts/asistencia-daemon/daemon.mts`:

```ts
#!/usr/bin/env node
// Daemon de asistencia — corre en una PC de casa (o del autor).
//
// Loguea al "Control de Asistencias" legacy con una cuenta-bot, pollea
// apply-leave.php cada ~2 min y, si hay materia(s) habilitada(s), llama a
// /api/webhooks/asistencia (que hace el broadcast idempotente por día/materia).
// Manda un heartbeat con métricas cada 10s a /api/asistencia/worker/heartbeat.
//
// Se corre con el TypeScript nativo de Node 22.6+/24 (node daemon.mts).
// Lo orquesta supervisor.mts (que lo reinicia y atiende comandos).
//
// Reemplaza al viejo agent.js de la raíz.

import os from "node:os";
import axios from "axios";
import * as cheerio from "cheerio";
import { CookieJar } from "tough-cookie";
import { metricas } from "./metricas.mts";

const CONFIG = {
  baseUrl: process.env.ASISTENCIA_BASE_URL || "https://asistencia.frsfco.utn.edu.ar:4443",
  appUrl: (process.env.CAMPUS_APP_URL || "https://campus-utn.vercel.app").replace(/\/$/, ""),
  secret: process.env.NOTIFICATIONS_WEBHOOK_SECRET || "",
  staticCookie: process.env.ASISTENCIA_COOKIE || "",
  username: process.env.ASISTENCIA_USER || "",
  password: process.env.ASISTENCIA_PASSWORD || "",
  usernameField: process.env.ASISTENCIA_USER_FIELD || "username",
  passwordField: process.env.ASISTENCIA_PASSWORD_FIELD || "password",
  loginPath: process.env.ASISTENCIA_LOGIN_PATH || "/index.php",
  pollMs: Number(process.env.ASISTENCIA_POLL_MS || 120000),
  workerId: (process.env.ASISTENCIA_WORKER_NAME || os.hostname() || "asistencia-daemon").slice(0, 80),
};

const jar = new CookieJar();
const client = axios.create({
  baseURL: CONFIG.baseUrl,
  timeout: 20000,
  maxRedirects: 5,
  headers: {
    "User-Agent": "Mozilla/5.0 CampusUTN-AsistenciaDaemon/1.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
});

client.interceptors.request.use(async (cfg) => {
  const url = new URL(cfg.url || "", cfg.baseURL || CONFIG.baseUrl).toString();
  const cookie = await jar.getCookieString(url);
  cfg.headers = { ...cfg.headers };
  if (cookie) cfg.headers.Cookie = cookie;
  if (CONFIG.staticCookie) {
    cfg.headers.Cookie = [cfg.headers.Cookie, CONFIG.staticCookie].filter(Boolean).join("; ");
  }
  return cfg;
});
client.interceptors.response.use(async (res) => {
  const setCookie = res.headers["set-cookie"] || [];
  const url = res.config.url
    ? new URL(res.config.url, res.config.baseURL || CONFIG.baseUrl).toString()
    : CONFIG.baseUrl;
  await Promise.all(setCookie.map((c: string) => jar.setCookie(c, url)));
  return res;
});

function ts() {
  return new Date().toISOString();
}

function formParamsFromHtml(html: string, extra: Record<string, string>) {
  const $ = cheerio.load(html);
  const params = new URLSearchParams();
  $("form input").each((_, input) => {
    const name = $(input).attr("name");
    if (!name) return;
    params.set(name, $(input).attr("value") || "");
  });
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return params;
}

async function loginIfNeeded() {
  if (CONFIG.staticCookie || !CONFIG.username || !CONFIG.password) {
    metricas.setLoginOk(!!CONFIG.staticCookie);
    return;
  }
  const page = await client.get(CONFIG.loginPath);
  const params = formParamsFromHtml(page.data, {
    [CONFIG.usernameField]: CONFIG.username,
    [CONFIG.passwordField]: CONFIG.password,
  });
  await client.post(CONFIG.loginPath, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  metricas.setLoginOk(true);
}

type Opcion = { id: string; name: string };

function parseActiveAttendance(html: string): { isOpen: boolean; activeOptions: Opcion[] } {
  const $ = cheerio.load(html);
  const activeOptions: Opcion[] = [];
  $('select[name="id_materia"] option').each((_, option) => {
    const el = $(option);
    const id = el.attr("value") || "";
    const name = el.text().replace(/\s+/g, " ").trim();
    const habilitada = (el.attr("data-habilitada") || "").toUpperCase();
    if (id && name && !el.is("[disabled]") && habilitada === "S") {
      activeOptions.push({ id, name });
    }
  });
  return { isOpen: activeOptions.length > 0, activeOptions };
}

async function avisarWebhook(activeOptions: Opcion[]) {
  const res = await axios.post(
    `${CONFIG.appUrl}/api/webhooks/asistencia`,
    { source: "asistencia-daemon", activeOptions },
    { timeout: 20000, headers: { "Content-Type": "application/json", "x-agent-secret": CONFIG.secret } }
  );
  const materias = (res.data?.materias ?? []) as { materia: string; enviado: boolean; sent?: number }[];
  for (const m of materias) {
    metricas.agregarMateria(m.materia);
    if (m.enviado && m.sent) metricas.sumarPushes(m.sent);
  }
  const enviadas = materias.filter((m) => m.enviado).length;
  console.log(`[${ts()}] webhook: ${materias.length} materia(s), ${enviadas} aviso(s) nuevo(s)`);
}

async function enviarHeartbeat(extra: Record<string, unknown> = {}) {
  if (!CONFIG.appUrl || !CONFIG.secret) return;
  try {
    await axios.post(
      `${CONFIG.appUrl}/api/asistencia/worker/heartbeat`,
      { id: CONFIG.workerId, estado: "activo", ...metricas.snapshot(), ...extra },
      { timeout: 10000, headers: { "Content-Type": "application/json", "x-worker-secret": CONFIG.secret } }
    );
  } catch (e) {
    console.warn(`[${ts()}] heartbeat error: ${String((e as Error).message).slice(0, 100)}`);
  }
}

async function poll() {
  try {
    await loginIfNeeded();
    const t0 = Date.now();
    const res = await client.get("/apply-leave.php");
    metricas.registrarRt(Date.now() - t0);
    metricas.registrarPoll();

    const { isOpen, activeOptions } = parseActiveAttendance(res.data);
    if (isOpen) {
      await avisarWebhook(activeOptions);
    } else {
      console.log(`[${ts()}] sin asistencia habilitada`);
    }
  } catch (error) {
    const msg = (error as { response?: { status?: number } }).response?.status
      ? `HTTP ${(error as { response: { status: number } }).response.status}`
      : (error as Error).message || "error desconocido";
    metricas.registrarError(msg);
    metricas.setLoginOk(false);
    console.error(`[${ts()}] ${msg}`);
  }
}

console.log(
  `[${ts()}] daemon '${CONFIG.workerId}' -> ${CONFIG.appUrl}  poll cada ${Math.round(CONFIG.pollMs / 1000)}s`
);

poll();
const pollTimer = setInterval(poll, CONFIG.pollMs);
const hbTimer = setInterval(() => void enviarHeartbeat(), 10000);
void enviarHeartbeat();

async function cerrar(signal: string) {
  clearInterval(pollTimer);
  clearInterval(hbTimer);
  console.log(`[${ts()}] cerrando (${signal})`);
  await enviarHeartbeat({ estado: "apagado", motivo: "cierre manual" });
  process.exit(0);
}
process.on("SIGINT", () => void cerrar("SIGINT"));
process.on("SIGTERM", () => void cerrar("SIGTERM"));
```

- [ ] **Step 3: Borrar `agent.js` y actualizar `.gitignore`**

```bash
git rm agent.js
```

En `.gitignore`, después del bloque `# proxy casero (...)`, agregar:

```
# asistencia daemon (local): config/secretos generados
scripts/asistencia-daemon/app-url.txt
scripts/asistencia-daemon/secret.txt
scripts/asistencia-daemon/credenciales.txt
```

Buscar referencias muertas a `agent.js`: `grep -rn "agent.js" --include='*.md' --include='*.json' --include='*.ps1' --include='*.yml' .` (ignorar `.waylog/`). Si `AGENTS.md` u otro doc lo menciona como algo a correr, actualizar la mención a `scripts/asistencia-daemon/start.ps1`.

- [ ] **Step 4: Chequeo de sintaxis**

Run: `node --check scripts/asistencia-daemon/metricas.mts && node --check scripts/asistencia-daemon/daemon.mts`
Expected: sin salida (OK). Si `--check` no soporta `.mts` en esta versión, correr `node -e "import('./scripts/asistencia-daemon/daemon.mts').catch(e=>{console.error(e);process.exit(1)})"` con las env vars vacías y matarlo con Ctrl+C tras ver la línea `daemon '...' -> ...` (confirma que carga y arranca).

- [ ] **Step 5: Verificar contra `next dev`**

Con `npm run dev` corriendo y la tabla `asistencia_workers` creada. En PowerShell, desde `scripts/asistencia-daemon/`:

```powershell
$env:CAMPUS_APP_URL = "http://localhost:3000"
$env:NOTIFICATIONS_WEBHOOK_SECRET = "<el mismo de .env.local>"
$env:ASISTENCIA_WORKER_NAME = "pc-dev"
$env:ASISTENCIA_POLL_MS = "15000"
# sin ASISTENCIA_USER/PASSWORD el login se saltea y el GET a apply-leave.php
# va a fallar (HTTP/timeout) — alcanza para ver el heartbeat y el manejo de error.
node daemon.mts
```

Expected en ~15s:
- Logs `[ISO] daemon 'pc-dev' -> http://localhost:3000 poll cada 15s`.
- En `/admin/dashboard` aparece la tarjeta `pc-dev` conectada, "Polls" subiendo, "Login legacy" fallando, "último error" con el `HTTP`/timeout del legacy.
- Ctrl+C → en ≤35s la tarjeta pasa a "Apagada: cierre manual".

Limpiar: borrar la fila `pc-dev`.

- [ ] **Step 6: Commit**

```bash
git add scripts/asistencia-daemon/metricas.mts scripts/asistencia-daemon/daemon.mts .gitignore
git rm agent.js
git commit -m "$(printf 'feat(asistencia): daemon .mts (porta agent.js) + metricas; borra agent.js\n\nSin estado local: el webhook decide si ya se aviso. Heartbeat con\nmetricas de poll cada 10s. Varias materias por vez.\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

## Task 7: Supervisor + arranque (`supervisor.mts`, `start.ps1`, `install-tarea.ps1`, `.service`, `README.md`)

**Files:**
- Create: `scripts/asistencia-daemon/supervisor.mts`
- Create: `scripts/asistencia-daemon/start.ps1`
- Create: `scripts/asistencia-daemon/install-tarea.ps1`
- Create: `scripts/asistencia-daemon/asistencia-worker.service`
- Create: `scripts/asistencia-daemon/README.md`

**Interfaces:**
- Consumes: `scripts/asistencia-daemon/daemon.mts` (Task 6); `GET|POST {CAMPUS_APP_URL}/api/asistencia/worker/comando` (Task 4).
- Produces: `node scripts/asistencia-daemon/supervisor.mts` mantiene vivo `daemon.mts` y ejecuta `reiniciar`/`frenar`/`arrancar`; `start.ps1` es el punto de entrada para el usuario y para la tarea de Windows.

- [ ] **Step 1: Crear `supervisor.mts` (calco de `scripts/captcha-remoto/supervisor.mts` sin túnel)**

`scripts/asistencia-daemon/supervisor.mts`:

```ts
// Supervisor del daemon de asistencia.
//
// - Levanta daemon.mts y lo reinicia si se cae (con backoff).
// - Cada 15s hace polling de GET /api/asistencia/worker/comando?id=X: si el
//   admin encoló "reiniciar" / "frenar" / "arrancar" desde /admin/dashboard, lo
//   ejecuta y lo confirma con POST. Sin SSH, sin puertos abiertos.
//
// Lo lanza start.ps1. Calco de scripts/captcha-remoto/supervisor.mts sin la
// parte del túnel (el daemon llama de salida, no necesita entrada).

import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const APP_URL = (process.env.CAMPUS_APP_URL || "").replace(/\/$/, "");
const SECRET = process.env.NOTIFICATIONS_WEBHOOK_SECRET || "";
const WORKER_ID = (process.env.ASISTENCIA_WORKER_NAME || os.hostname() || "asistencia-daemon").slice(0, 80);
const DAEMON_MTS = path.join(import.meta.dirname, "daemon.mts");

let daemon: ChildProcess | null = null;
let frenado = false;
let apagando = false;
let backoff = 2000;

function log(...a: unknown[]) {
  console.log("[sup]", ...a);
}

function matarArbol(p: ChildProcess | null) {
  if (!p || p.exitCode !== null || p.pid == null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      p.kill("SIGTERM");
      setTimeout(() => {
        try {
          p.kill("SIGKILL");
        } catch {
          /* ya murió */
        }
      }, 3000);
    }
  } catch {
    /* nada */
  }
}

function abrirDaemon() {
  const p = spawn(process.execPath, [DAEMON_MTS], {
    stdio: "inherit",
    env: { ...process.env, ASISTENCIA_WORKER_NAME: WORKER_ID },
  });
  daemon = p;
  p.on("exit", (code, sig) => {
    if (apagando || frenado) return;
    log(`daemon salió (code=${code} sig=${sig}), reinicio en ${backoff}ms`);
    setTimeout(reiniciarCiclo, backoff);
    backoff = Math.min(backoff * 2, 30000);
  });
}

let reiniciando = false;
function reiniciarCiclo() {
  if (apagando || reiniciando) return;
  reiniciando = true;
  try {
    matarArbol(daemon);
    daemon = null;
    setTimeout(() => {
      if (!frenado && !apagando) {
        abrirDaemon();
        backoff = 2000;
        log("daemon arrancado");
      }
      reiniciando = false;
    }, 1000);
  } catch (e) {
    log("fallo el ciclo:", String((e as Error).message || e));
    reiniciando = false;
    setTimeout(reiniciarCiclo, 5000);
  }
}

async function pollComandos() {
  if (!APP_URL || !SECRET || apagando) return;
  try {
    const r = await fetch(`${APP_URL}/api/asistencia/worker/comando?id=${encodeURIComponent(WORKER_ID)}`, {
      headers: { "x-worker-secret": SECRET },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return;
    const j = (await r.json()) as { cmd?: string | null; nonce?: string };
    if (!j.cmd || !j.nonce) return;
    log("comando recibido:", j.cmd);
    if (j.cmd === "frenar") {
      frenado = true;
      matarArbol(daemon);
      daemon = null;
    } else if (j.cmd === "arrancar" || j.cmd === "reiniciar") {
      frenado = false;
      reiniciarCiclo();
    }
    await fetch(`${APP_URL}/api/asistencia/worker/comando`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": SECRET },
      body: JSON.stringify({ id: WORKER_ID, nonce: j.nonce }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* reintenta en el próximo poll */
  }
}

log(`supervisor de '${WORKER_ID}'  comandos=${APP_URL && SECRET ? "ON" : "OFF"}`);
reiniciarCiclo();
setInterval(() => void pollComandos(), 15000).unref?.();

const cerrar = () => {
  if (apagando) return;
  apagando = true;
  log("cerrando...");
  matarArbol(daemon);
  setTimeout(() => process.exit(0), 1500);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
```

- [ ] **Step 2: Crear `start.ps1` (calco de `scripts/captcha-remoto/start.ps1`)**

`scripts/asistencia-daemon/start.ps1`:

```powershell
# ---------------------------------------------------------------------------
# Daemon de asistencia (vía supervisor).
#
# Loguea al "Control de Asistencias" legacy con una cuenta-bot, pollea
# apply-leave.php y avisa a /api/webhooks/asistencia cuando se habilita la
# asistencia de una materia. El SUPERVISOR (supervisor.mts) lo mantiene vivo y
# atiende comandos desde /admin/dashboard (reiniciar / frenar / arrancar).
#
# Params:
#   -Name TXT     nombre del worker en el monitor (default: hostname)
#   -AppUrl URL   base de la app (heartbeat + comandos). Se guarda en app-url.txt.
#   -PollMs N     intervalo de poll en ms (default 120000)
#
# Setup (una vez):
#   1) Supabase: correr scripts/asistencia-workers.sql y
#      scripts/asistencia-avisos-log.sql
#   2) Pegar el MISMO NOTIFICATIONS_WEBHOOK_SECRET que está en Vercel en
#      scripts/asistencia-daemon/secret.txt
#   3) Poner usuario y password de la cuenta-bot en credenciales.txt (2 líneas)
#
# Auto-arranque al bootear:  .\install-tarea.ps1 -Args "-AppUrl https://... -Name esta-pc"
# ---------------------------------------------------------------------------
param(
  [string]$Name = "",
  [string]$AppUrl = "",
  [int]$PollMs = 0
)
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$root = (Resolve-Path (Join-Path $dir "..\..")).Path

# 1) Secreto (mismo que Vercel) — NO se genera, lo pega el usuario.
$secretFile = Join-Path $dir "secret.txt"
if (-not (Test-Path $secretFile)) {
  Write-Host "FALTA scripts/asistencia-daemon/secret.txt — pegá ahí el NOTIFICATIONS_WEBHOOK_SECRET de Vercel."
  exit 1
}
$SECRET = (Get-Content $secretFile -Raw).Trim()

# 2) Credenciales de la cuenta-bot del legacy (2 líneas: usuario / password)
$credFile = Join-Path $dir "credenciales.txt"
if (-not (Test-Path $credFile)) {
  Write-Host "FALTA scripts/asistencia-daemon/credenciales.txt — 2 líneas: usuario y password de la cuenta-bot."
  exit 1
}
$cred = Get-Content $credFile
$ASIS_USER = ($cred | Select-Object -First 1).Trim()
$ASIS_PASS = ($cred | Select-Object -Skip 1 -First 1).Trim()

# 3) App URL
$appUrlFile = Join-Path $dir "app-url.txt"
if ($AppUrl) { $AppUrl.TrimEnd("/") | Set-Content $appUrlFile -Encoding ascii -NoNewline }
elseif (Test-Path $appUrlFile) { $AppUrl = (Get-Content $appUrlFile -Raw).Trim() }
if (-not $AppUrl) { Write-Host "AVISO: sin -AppUrl no hay monitor ni comandos remotos." }

# 4) Nombre + versión
if (-not $Name) { $Name = $env:COMPUTERNAME }
$VER = ""
try { Push-Location $root; $VER = (& git rev-parse --short HEAD 2>$null); Pop-Location } catch {}

# 5) Node 22.6+
$nodeMajor = [int](& node -e "console.log(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 22) { throw "Node ${nodeMajor}: se necesita Node 22.6+ (idealmente 24)." }

# 6) Env para el supervisor
$env:CAMPUS_APP_URL = $AppUrl
$env:NOTIFICATIONS_WEBHOOK_SECRET = $SECRET
$env:ASISTENCIA_WORKER_NAME = $Name
$env:ASISTENCIA_WORKER_VERSION = "$VER"
$env:ASISTENCIA_USER = $ASIS_USER
$env:ASISTENCIA_PASSWORD = $ASIS_PASS
if ($PollMs -gt 0) { $env:ASISTENCIA_POLL_MS = "$PollMs" }

Write-Host ""
Write-Host "===================================================================="
Write-Host " Daemon de asistencia '$Name'  ver=$VER"
Write-Host "   Monitor/comandos: $(if($AppUrl){$AppUrl}else{'OFF (pasá -AppUrl)'})"
Write-Host "   Poll: $(if($PollMs){$PollMs}else{'120000'}) ms"
Write-Host ""
Write-Host " El supervisor mantiene vivo el daemon y atiende /admin/dashboard."
Write-Host " Ctrl+C para frenar."
Write-Host "===================================================================="
Write-Host ""

& node (Join-Path $dir "supervisor.mts")
```

- [ ] **Step 3: Crear `install-tarea.ps1` (calco de `scripts/captcha-remoto/install-tarea.ps1`)**

`scripts/asistencia-daemon/install-tarea.ps1`:

```powershell
# Registra el daemon de asistencia como tarea de Windows que arranca al iniciar
# sesión y se reinicia sola si falla. Ejecutar UNA vez.
#
#   .\install-tarea.ps1 -Args "-AppUrl https://campusutn.dpdns.org -Name esta-pc"
#
# Quitar:  Unregister-ScheduledTask -TaskName CampusAsistenciaWorker -Confirm:$false
param([string]$Args = "")
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$start = Join-Path $dir "start.ps1"
if (-not (Test-Path $start)) { throw "No encuentro start.ps1 en $dir" }

$cmd = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$start`" $Args"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $cmd
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "CampusAsistenciaWorker" -Action $action -Trigger $trigger `
  -Settings $settings -Force -RunLevel Highest | Out-Null

Write-Host "Tarea 'CampusAsistenciaWorker' registrada. Arranca al iniciar sesión de Windows."
Write-Host "Args: $Args"
Write-Host "Probar ahora:  Start-ScheduledTask -TaskName CampusAsistenciaWorker"
```

- [ ] **Step 4: Crear `asistencia-worker.service` (calco de `scripts/captcha-remoto/captcha-worker.service`)**

`scripts/asistencia-daemon/asistencia-worker.service`:

```ini
# systemd unit para una PC Linux "definitiva".
#
#   sudo cp scripts/asistencia-daemon/asistencia-worker.service /etc/systemd/system/
#   sudo vi /etc/systemd/system/asistencia-worker.service   # completar User/paths/secretos
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now asistencia-worker
#   journalctl -u asistencia-worker -f

[Unit]
Description=Campus UTN - daemon de asistencia (supervisor)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=CAMBIAR_USUARIO
WorkingDirectory=/home/CAMBIAR_USUARIO/campus-utn
Environment=CAMPUS_APP_URL=https://campusutn.dpdns.org
Environment=NOTIFICATIONS_WEBHOOK_SECRET=PEGAR_SECRETO
Environment=ASISTENCIA_WORKER_NAME=pc-linux
Environment=ASISTENCIA_USER=PEGAR_USUARIO_BOT
Environment=ASISTENCIA_PASSWORD=PEGAR_PASSWORD_BOT
Environment=ASISTENCIA_POLL_MS=120000
ExecStart=/usr/bin/node scripts/asistencia-daemon/supervisor.mts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 5: Crear `README.md`**

`scripts/asistencia-daemon/README.md`:

```markdown
# Daemon de asistencia

Vigila el "Control de Asistencias" legacy de la facultad
(`asistencia.frsfco.utn.edu.ar:4443`) y, cuando se habilita la asistencia de una
materia, dispara una notificación push a la PWA de todos los usuarios que tengan
el aviso de asistencia activado. Al tocar la notificación se abre `/asistencia`.

## Por qué corre local (y no en un cron en la nube)

- Hay que pollear cada ~2 min. Vercel Cron (Hobby) corre 1 vez por día;
  GitHub Actions, cada 5 min y con retrasos → el aviso llegaría tarde.
- El legacy chequea la red de la facultad. Desde una IP residencial / de la
  facultad es menos probable que bloquee que desde una IP de datacenter.

El daemon **no guarda estado local**: cada vuelta le pregunta al legacy y le
avisa al servidor; el servidor (`/api/webhooks/asistencia`) decide si ya se
avisó hoy de esa materia. Podés tener dos PCs corriéndolo: no se duplica el
aviso (y en el monitor se ven como dos workers).

## Requisitos

- Node 22.6+ en el PATH (idealmente 24). Windows con PowerShell.

## Setup (una vez)

1. En Supabase → SQL Editor, correr `scripts/asistencia-workers.sql` y
   `scripts/asistencia-avisos-log.sql`.
2. Crear `scripts/asistencia-daemon/secret.txt` con el **mismo**
   `NOTIFICATIONS_WEBHOOK_SECRET` que está en Vercel.
3. Crear `scripts/asistencia-daemon/credenciales.txt` con 2 líneas: usuario y
   password de la cuenta-bot del legacy (es el legajo + DNI, igual que Sysacad).

Los tres `*.txt` están gitignoreados.

## Uso

```powershell
cd scripts/asistencia-daemon
.\start.ps1 -AppUrl https://campusutn.dpdns.org -Name esta-pc
```

Dejá la ventana abierta. `Ctrl+C` para frenar.

## Monitor y control remoto

En `/admin/dashboard`, sección "Daemon de asistencia — workers": ves si la PC
está conectada, hace cuánto, polls, tiempo de respuesta del legacy, errores,
materias detectadas hoy y pushes enviadas hoy. Los botones **Reiniciar /
Frenar / Arrancar** encolan un comando que el `supervisor.mts` ejecuta en ≤15s.

## Auto-arranque al bootear

```powershell
.\install-tarea.ps1 -Args "-AppUrl https://campusutn.dpdns.org -Name esta-pc"
```

Registra la tarea de Windows `CampusAsistenciaWorker` (arranca al iniciar
sesión, se reinicia sola si falla). En Linux: `asistencia-worker.service`.

## Mover a otra PC

Clonar el repo, copiar los `*.txt` (`secret.txt`, `credenciales.txt`,
`app-url.txt`), tener Node 22.6+, `.\start.ps1`.

## Usuarios nuevos

No hay nada que hacer. El aviso llega a toda suscripción push activa; cuando un
alumno instala la PWA y activa notificaciones, `/notificaciones` le crea el
perfil con la asistencia activada y el próximo aviso ya le llega.
```

- [ ] **Step 6: Chequeo de sintaxis + typecheck del repo**

Run: `node --check scripts/asistencia-daemon/supervisor.mts && npm run typecheck && npm run lint`
Expected: PASS (el `typecheck`/`lint` del proyecto no toca `scripts/*.mts`, pero confirma que nada se rompió).

- [ ] **Step 7: Verificar el ciclo supervisor + comando contra `next dev`**

Con `npm run dev`, tabla creada, y `secret.txt` + `credenciales.txt` con cualquier valor de prueba (el login va a fallar pero el heartbeat y los comandos funcionan):

```powershell
cd scripts/asistencia-daemon
.\start.ps1 -AppUrl http://localhost:3000 -Name pc-sup -PollMs 15000
```

Expected:
- Logs `[sup] supervisor de 'pc-sup' comandos=ON` y `[sup] daemon arrancado`, y los logs del daemon (`daemon 'pc-sup' -> ...`).
- En `/admin/dashboard` la tarjeta `pc-sup` conectada.
- Matar el proceso `node daemon.mts` desde el Task Manager → `[sup] daemon salió ... reinicio en 2000ms` y vuelve.
- En el dashboard, click "Frenar" → en ≤15s `[sup] comando recibido: frenar`, el daemon se detiene, la etiqueta pasa a "frenar · confirmado ✓", y la tarjeta pasa a desconectada.
- Click "Arrancar" → `[sup] comando recibido: arrancar`, el daemon vuelve, tarjeta conectada.
- `Ctrl+C` en la ventana de `start.ps1` → `[sup] cerrando...` y todo baja.

Limpiar: borrar la fila `pc-sup` de `asistencia_workers`.

- [ ] **Step 8: Commit**

```bash
git add scripts/asistencia-daemon/supervisor.mts scripts/asistencia-daemon/start.ps1 scripts/asistencia-daemon/install-tarea.ps1 scripts/asistencia-daemon/asistencia-worker.service scripts/asistencia-daemon/README.md
git commit -m "$(printf 'feat(asistencia): supervisor + start.ps1 + auto-arranque (calco de captcha-remoto)\n\nsupervisor.mts mantiene vivo el daemon y atiende reiniciar/frenar/arrancar\ndesde /admin/dashboard. Mirror por-script: tarea CampusAsistenciaWorker propia.\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

## Self-Review

**1. Spec coverage:**

| Sección del spec | Task |
|---|---|
| Componente 1 — `scripts/asistencia-daemon/` (daemon, packaging) | Task 6 (daemon + metricas), Task 7 (start.ps1, README, auto-arranque) |
| Componente 2 — dedup + `/api/webhooks/asistencia` loop por materia | Task 2 |
| Componente 3 — pruebas desde `/admin/dashboard` (email / todos) | Task 3 |
| Componente 4 — usuarios nuevos (sólo doc) | Task 7 Step 5 (README "Usuarios nuevos") |
| Componente 5 — monitor: tabla `asistencia_workers`, heartbeat, admin endpoints, sección, retiro de lo viejo | Task 1 (tabla), Task 4 (endpoints), Task 5 (sección + retiro) |
| Componente 6 — supervisor + comandos + auto-arranque | Task 1 (columnas de comando), Task 4 (`worker/comando` + `admin/asistencia-command`), Task 7 (supervisor, install-tarea, .service) |
| Decisión 7 — reusar `NOTIFICATIONS_WEBHOOK_SECRET` / `x-worker-secret` | Task 4 (todos los endpoints), Global Constraints |
| Retiro `asistencia_agent_status` / `/api/asistencia/agent` / `AgentStatus` / `notify` | Task 5 Steps 3–5 |
| Borrar `agent.js` | Task 6 Step 3 |
| `.gitignore` de los `*.txt` | Task 6 Step 3 |

Sin huecos.

**2. Placeholder scan:** sin "TBD"/"TODO"/"como Task N". Los archivos "calco de X" traen o el código completo esperado (heartbeat, comando, admin-*, secciones, supervisor, daemon, metricas) o los reemplazos textuales exactos (`comando/route.ts` en Task 4 Step 2, que además incluye el resultado completo para verificar). Cada paso de código tiene bloque de código.

**3. Type consistency:**
- `metricas.snapshot()` (Task 6) emite `proceso_desde, version, ram_total_mb, ram_usada_mb, polls_total, errores, login_ok, ultimo_error, rt_ultimo_ms, rt_prom_ms, rt_max_ms, rt_min_ms, materias_hoy, pushes_hoy` → `/api/asistencia/worker/heartbeat` (Task 4) lee exactamente esas claves → columnas de `asistencia_workers` (Task 1) → tipo `Worker` en `AsistenciaWorkersSection.tsx` (Task 5). Coinciden.
- `/api/webhooks/asistencia` responde `{ materias: [{ materiaId, materia, enviado, sent? }] }` (Task 2) → `daemon.mts` lee `res.data.materias[].materia` y `.enviado` y `.sent` (Task 6). Coincide.
- Comandos: valores `reiniciar|frenar|arrancar` en `admin/asistencia-command` (Task 4), en los botones de `AsistenciaWorkersSection` (Task 5) y en `pollComandos` del supervisor (Task 7). Coinciden.
- `x-agent-secret` lo usa el webhook (Task 2, sin cambio respecto de hoy) y lo manda `daemon.mts` en `avisarWebhook` (Task 6). `x-worker-secret` lo usan los endpoints `worker/*` (Task 4) y lo mandan `daemon.mts` (heartbeat) y `supervisor.mts` (comandos) (Tasks 6–7). Consistente con la decisión 7.

Sin inconsistencias.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-03-notificaciones-asistencia-daemon.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
