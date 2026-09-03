# Asistencia: cobertura total vía credenciales cifradas por usuario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El daemon de asistencia detecta la asistencia abierta de todas las materias que cursa cualquier usuario con "Avisar asistencia disponible" activo, usando la credencial de Sysacad de cada uno guardada cifrada en Supabase.

**Architecture:** Cuando un usuario tiene el aviso de asistencia activo, la app cifra su `sysacadws_auth` (= `base64(legajo:DNI)`) con `lib/crypto.ts:encryptCred` y lo upsertea en la tabla `asistencia_credenciales` (keyed por legajo). Se refresca en el keepalive de `SessionGuard` y se borra en el logout de Sysacad o al desactivar el toggle. El daemon pide las credenciales a un endpoint gated por `x-worker-secret` (el server descifra), se loguea al "Control de Asistencias" legacy como cada usuario reusando `lib/asistenciaLegacy.ts`, descubre las comisiones que ve cada cuenta, deduplica por comisión, y chequea una cuenta representante por comisión cada ~10 min con rate-limit y caché de sesión PHP. Al detectar `data-habilitada="S"` llama al webhook `/api/webhooks/asistencia` que ya existía (idempotente por día/materia).

**Tech Stack:** Next.js 16.2.6 App Router (route handlers `runtime = "nodejs"`), Supabase REST vía `lib/supabase.ts:supabaseFetch`, `lib/crypto.ts` (AES-256-GCM), `lib/asistenciaLegacy.ts` (login + scrape del legacy), TypeScript nativo de Node 24 para `scripts/asistencia-daemon/daemon.mts` (importa `lib/` por ruta relativa), PowerShell para `start.ps1`.

**Spec:** `docs/superpowers/specs/2026-09-03-asistencia-credenciales-por-usuario-design.md`
(continúa `docs/superpowers/specs/2026-09-02-notificaciones-asistencia-daemon-design.md`, rama `feat/notificaciones-asistencia-daemon`)

## Global Constraints

- **No hay suite de tests** (CLAUDE.md). Verificación de cada tarea: `npm run typecheck` + `npx eslint <archivos>` sin errores nuevos + pasos manuales con salida esperada. No agregar framework de tests.
- **`npm run lint` global ya falla con 63 errores pre-existentes en la rama** (hooks deps en ~40 archivos + `public/pdf.worker.min.mjs`). El criterio es `npx eslint` limpio en los archivos nuevos/cambiados.
- **Next 16.2.6 tiene breaking changes** (AGENTS.md): leer `node_modules/next/dist/docs/` antes de escribir route handlers.
- **Route handlers nuevos:** `export const runtime = "nodejs";`. Los que leen estado vivo o descifran: además `export const dynamic = "force-dynamic";`.
- **Secreto de los endpoints del worker:** header `x-worker-secret` validado contra `process.env.NOTIFICATIONS_WEBHOOK_SECRET`. El webhook `/api/webhooks/asistencia` sigue con `x-agent-secret`.
- **Cifrado:** `import { encryptCred, decryptCred } from "@/lib/crypto"`. `encryptCred(plain: string): string` (base64url), `decryptCred(token: string): string | null`. Clave derivada de `SESSION_SECRET` — nunca sale del server.
- **La credencial que se guarda** es el valor crudo de la cookie `sysacadws_auth`, que ya es `base64(legajo:dni)`. `legajo = atob(sysacadws_auth).split(":")[0]`, `dni = atob(sysacadws_auth).split(":")[1]`.
- **Login al legacy = por formulario**, no HTTP Basic. Se reusa `lib/asistenciaLegacy.ts:login(legajo, dni)` (hace `GET /index.php` → `POST /index.php` con `legajo`+`password=dni` → valida con `GET /apply-leave.php`), devuelve un string de cookies o `null`.
- **Forma de comisión** = la de `lib/asistenciaLegacy.ts:AsistenciaMateria`: `{ id, anio, especialidad, plan, comision, condicional, habilitada, nombre }`. La `comisiones` jsonb guarda `AsistenciaMateria[]` (con `condicional`/`habilitada` tal como vinieron en el momento del descubrimiento — no se usan para la clave).
- **Clave de comisión** (dedup): `` `${m.especialidad}|${m.plan}|${m.comision}|${m.id}` ``.
- **Zona horaria "hoy":** `America/Argentina/Buenos_Aires`.
- **Rate-limit del legacy:** ≥ 3000 ms entre operaciones del daemon contra `ASISTENCIA_BASE_URL` (una "operación" = un `login()` ó un `fetchApplyLeave()`; el `login()` internamente hace 3 requests seguidos, se acepta ese micro-burst).
- **Cadencias del daemon:** `refrescarCuentas` cada 30 min; descubrimiento 1 por minuto (cola); loop de chequeo cada 10 min, escalonado dentro de la ventana; caché de sesión PHP válida 20 min; `comisiones` de una cuenta se re-descubre si `comisiones_at` > 7 días; `visto_at` > 30 días → la credencial no se entrega al daemon.
- **Commits:** terminar el mensaje con `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **Ya en la rama** (spec anterior, no se re-implementa): `POST /api/webhooks/asistencia` (idempotente por `asistencia_avisos_log`), `scripts/asistencia-daemon/{daemon.mts,supervisor.mts,metricas.mts,start.ps1,...}`, tabla `asistencia_workers` + `/api/asistencia/worker/heartbeat` + `/api/admin/asistencia-workers` + `AsistenciaWorkersSection.tsx`.

---

## File Structure

**Supabase (SQL, se corren a mano):**
- `scripts/asistencia-credenciales.sql` (nuevo) — tabla `asistencia_credenciales`.
- `scripts/asistencia-workers.sql` (editar) — 2 columnas `cuentas`, `comisiones`.
- `scripts/notifications.sql` (editar) — anexar la tabla nueva + `ALTER` de las 2 columnas.

**Route handlers (captura):**
- `app/api/asistencia/credencial/refresh/route.ts` (nuevo) — `POST`: cookies → `encryptCred` → upsert / delete en `asistencia_credenciales`.
- `app/api/sysacadws/login/route.ts` (editar) — en `DELETE`, borra la fila del legajo.

**Route handlers (entrega al daemon):**
- `app/api/asistencia/credenciales/route.ts` (nuevo) — `GET` gated por `x-worker-secret`: devuelve `[{ legajo, auth, comisiones, comisiones_at }]` con `auth` descifrado.
- `app/api/asistencia/credenciales/comisiones/route.ts` (nuevo) — `POST` gated: el daemon escribe el mapa de comisiones + maneja `strikes`.

**UI:**
- `components/SessionGuard.tsx` (editar) — 1 línea fire-and-forget al refresh en el keepalive.
- `app/notificaciones/page.tsx` (editar) — llamar al refresh tras togglear asistencia; subtexto de consentimiento.
- `app/admin/dashboard/_components/AsistenciaWorkersSection.tsx` (editar) — 2 `Dato` (`Cuentas`, `Comisiones`).

**Daemon:**
- `scripts/asistencia-daemon/daemon.mts` (reescritura del flujo) — multi-cuenta desde el endpoint, descubrimiento, dedup por comisión, loop escalonado, rate-limit, caché de sesión.
- `app/api/asistencia/worker/heartbeat/route.ts` (editar) — persistir `cuentas`, `comisiones`.

**Limpieza:**
- `scripts/asistencia-daemon/start.ps1` (editar) — sin `credenciales.txt`, sin `-PollMs`.
- `scripts/asistencia-daemon/asistencia-worker.service` (editar) — sin `ASISTENCIA_USER/PASSWORD/POLL_MS`.
- `scripts/asistencia-daemon/README.md` (editar) — sin cuenta-bot.
- `.gitignore` (editar) — quita la línea de `credenciales.txt`.

---

## Task 1: Esquema Supabase

**Files:**
- Create: `scripts/asistencia-credenciales.sql`
- Modify: `scripts/asistencia-workers.sql`
- Modify: `scripts/notifications.sql`

**Interfaces:**
- Produces: tabla `asistencia_credenciales` (`legajo` PK, `cred_cifrada`, `email`, `comisiones` jsonb, `comisiones_at`, `strikes`, `visto_at`, `creado_at`).
- Produces: `asistencia_workers` gana `cuentas integer default 0`, `comisiones integer default 0`.

- [ ] **Step 1: Crear `scripts/asistencia-credenciales.sql`**

```sql
-- Credenciales de Sysacad cifradas de los usuarios con "Avisar asistencia
-- disponible" activo. Las escribe /api/asistencia/credencial/refresh; las lee
-- (descifradas) /api/asistencia/credenciales para el daemon.
-- El cifrado es AES-256-GCM con clave derivada de SESSION_SECRET (lib/crypto.ts).

create table if not exists public.asistencia_credenciales (
  legajo         text primary key,       -- plano (está en el carnet; ya es path param del WS)
  cred_cifrada   text not null,          -- encryptCred(valor de la cookie sysacadws_auth) = enc(base64("legajo:dni"))
  email          text,                   -- username de Moodle, linkea con perfil_notificaciones
  comisiones     jsonb,                  -- AsistenciaMateria[]; null hasta el 1er descubrimiento del daemon
  comisiones_at  timestamptz,            -- cuándo se refrescó el mapa de comisiones
  strikes        integer not null default 0,  -- descubrimientos consecutivos con 0 comisiones
  visto_at       timestamptz not null default now(),  -- último refresh desde la app
  creado_at      timestamptz not null default now()
);

create index if not exists asistencia_credenciales_visto_idx
  on public.asistencia_credenciales (visto_at desc);

-- Solo el service role (backend) toca esta tabla.
alter table public.asistencia_credenciales enable row level security;
```

- [ ] **Step 2: Agregar 2 columnas a `scripts/asistencia-workers.sql`**

En la definición de `create table ... public.asistencia_workers (...)`, después de `pushes_hoy     integer not null default 0,` agregar:

```sql
  cuentas        integer not null default 0,   -- credenciales de usuarios cargadas
  comisiones     integer not null default 0,   -- comisiones distintas cubiertas
```

- [ ] **Step 3: Anexar al consolidado `scripts/notifications.sql`**

Al final del archivo, agregar:

```sql

-- ─────────────────────────────────────────────────────────────────────────────
-- Asistencia: cobertura total vía credenciales cifradas por usuario
-- (ver scripts/asistencia-credenciales.sql)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asistencia_credenciales (
  legajo         TEXT PRIMARY KEY,
  cred_cifrada   TEXT NOT NULL,
  email          TEXT,
  comisiones     JSONB,
  comisiones_at  TIMESTAMP WITH TIME ZONE,
  strikes        INTEGER NOT NULL DEFAULT 0,
  visto_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  creado_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE asistencia_workers
  ADD COLUMN IF NOT EXISTS cuentas    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comisiones INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 4: Verificar coherencia**

Leer los tres archivos. Confirmar: `asistencia_credenciales` tiene las mismas columnas en `scripts/asistencia-credenciales.sql` y en el bloque de `scripts/notifications.sql`; `asistencia_workers` suma `cuentas` y `comisiones` en los dos lugares donde se define.

- [ ] **Step 5: Commit**

```bash
git add scripts/asistencia-credenciales.sql scripts/asistencia-workers.sql scripts/notifications.sql
git commit -m "$(printf 'feat(asistencia): schema asistencia_credenciales + columnas cuentas/comisiones\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

> **Nota para quien ejecute:** correr `scripts/asistencia-credenciales.sql` y el `ALTER` de `asistencia_workers` en Supabase → SQL Editor antes de probar las Tasks 2, 3, 4, 5.

---

## Task 2: Captura de la credencial

**Files:**
- Create: `app/api/asistencia/credencial/refresh/route.ts`
- Modify: `components/SessionGuard.tsx`
- Modify: `app/notificaciones/page.tsx`
- Modify: `app/api/sysacadws/login/route.ts`

**Interfaces:**
- Consumes: `encryptCred` de `@/lib/crypto`; `supabaseFetch` de `@/lib/supabase`; tabla `asistencia_credenciales` (Task 1); cookies `moodle_user` y `sysacadws_auth`.
- Produces: `POST /api/asistencia/credencial/refresh` → siempre `200`. Con asistencia on + `sysacadws_auth` presente: upsert de `{ legajo, cred_cifrada, email, visto_at }`. Con asistencia off o sin perfil: `DELETE` de la fila del legajo.

- [ ] **Step 1: Crear el route handler**

`app/api/asistencia/credencial/refresh/route.ts`:

```ts
// Guarda / borra la credencial de Sysacad cifrada del usuario actual, según su
// preferencia "Avisar asistencia disponible". La usa el daemon de asistencia
// para loguearse al legacy como el usuario y ver sus comisiones.
//
// Se llama fire-and-forget desde SessionGuard (keepalive) y desde
// /notificaciones al togglear. NUNCA rompe el flujo que la invoca: cualquier
// error responde 200.

import { NextRequest, NextResponse } from "next/server";
import { encryptCred } from "@/lib/crypto";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function emailFromCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { username?: string; userid?: number };
    return p.username ?? (p.userid ? String(p.userid) : null);
  } catch {
    return null;
  }
}

function legajoFromAuth(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const dec = Buffer.from(raw, "base64").toString("utf8");
    const legajo = dec.split(":")[0]?.trim();
    return legajo || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.cookies.get("sysacadws_auth")?.value;
    const legajo = legajoFromAuth(auth);
    const email = emailFromCookie(req.cookies.get("moodle_user")?.value);
    if (!auth || !legajo) {
      return NextResponse.json({ ok: false }, { status: 200 }); // sin sesión de Sysacad
    }

    // ¿El usuario quiere el aviso de asistencia?
    let quiere = false;
    if (email) {
      const res = await supabaseFetch(
        `perfil_notificaciones?email=eq.${encodeURIComponent(email)}&select=notificar_asistencia,notificaciones_globales_activas`
      );
      if (res.ok) {
        const rows = (await res.json()) as {
          notificar_asistencia: boolean;
          notificaciones_globales_activas: boolean;
        }[];
        const p = rows[0];
        quiere = !!p && p.notificar_asistencia && p.notificaciones_globales_activas;
      }
    }

    if (!quiere) {
      await supabaseFetch(`asistencia_credenciales?legajo=eq.${encodeURIComponent(legajo)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      }).catch(() => {});
      return NextResponse.json({ ok: true, stored: false }, { status: 200 });
    }

    await supabaseFetch("asistencia_credenciales?on_conflict=legajo", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        legajo,
        cred_cifrada: encryptCred(auth),
        email,
        visto_at: new Date().toISOString(),
      }),
    });
    return NextResponse.json({ ok: true, stored: true }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
```

- [ ] **Step 2: Enganchar en `SessionGuard`**

En `components/SessionGuard.tsx`, en el bloque `if (k === "campus") {` del keepalive (donde ya está `fetch("/api/notifications/push-subscription/session", { method: "POST" }).catch(() => {});`), agregar en la línea siguiente:

```ts
            fetch("/api/asistencia/credencial/refresh", { method: "POST" }).catch(() => {});
```

- [ ] **Step 3: Enganchar en `/notificaciones` + subtexto de consentimiento**

En `app/notificaciones/page.tsx`:

1. En el `onChange` del `<Toggle>` de la `<Row label="Avisar asistencia disponible">` (sección Asistencia), que hoy es `onChange={(next) => updateProfile({ notificar_asistencia: next })}`, cambiarlo a:

```tsx
                        onChange={async (next) => {
                          await updateProfile({ notificar_asistencia: next });
                          fetch("/api/asistencia/credencial/refresh", { method: "POST" }).catch(() => {});
                        }}
```

2. En el master switch (`<Toggle checked={globalActive} onChange={async (next) => { ... }}`), después del bloque que reactiva las materias, agregar:

```tsx
                      fetch("/api/asistencia/credencial/refresh", { method: "POST" }).catch(() => {});
```

3. Debajo de esa `<Row label="Avisar asistencia disponible">` (dentro del mismo `<div className="divide-y ...">` de la sección Asistencia), agregar una fila de ayuda:

```tsx
                      <p className="px-4 py-2 text-[12px] leading-relaxed text-[var(--secondary)]">
                        Para avisarte, Campus guarda tu credencial de Sysacad cifrada y revisa la
                        asistencia por vos. Se borra si desactivás esto o cerrás sesión de Sysacad.
                      </p>
```

- [ ] **Step 4: Borrado en el logout de Sysacad**

En `app/api/sysacadws/login/route.ts`, en la función `DELETE`:

1. Cambiar la firma a `export async function DELETE(req: NextRequest) {` (agregar el import de `NextRequest` si el archivo solo importa `NextResponse` — revisar la línea de import de `next/server`).
2. Al principio de la función, antes de armar el `response`, agregar:

```ts
  // Borra la credencial guardada para el daemon de asistencia (best-effort).
  try {
    const auth = req.cookies.get("sysacadws_auth")?.value;
    const legajo = auth ? Buffer.from(auth, "base64").toString("utf8").split(":")[0]?.trim() : null;
    if (legajo) {
      await supabaseFetch(`asistencia_credenciales?legajo=eq.${encodeURIComponent(legajo)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
    }
  } catch {
    /* no bloquea el logout */
  }
```

3. Agregar el import: `import { supabaseFetch } from "@/lib/supabase";`

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npx eslint app/api/asistencia/credencial/refresh/route.ts components/SessionGuard.tsx app/notificaciones/page.tsx app/api/sysacadws/login/route.ts`
Expected: typecheck PASS; eslint sin salida.

- [ ] **Step 6: Verificar (manual, contra `next dev` + Supabase con la tabla creada)**

```bash
SECRET=$(grep -E '^NOTIFICATIONS_WEBHOOK_SECRET=' .env.local | cut -d= -f2-)
```

1. Loguearse en Moodle **y** Sysacad en el navegador. En `/notificaciones` activar "Avisar asistencia disponible".
2. En Supabase → `asistencia_credenciales`: aparece una fila con tu `legajo`, `email`, `visto_at` reciente, `cred_cifrada` no vacío, `comisiones` null.
3. Desactivar el toggle → la fila desaparece.
4. Reactivar → vuelve a aparecer.
5. Cerrar sesión de Sysacad (botón de logout que pega a `DELETE /api/sysacadws/login`) → la fila desaparece.
6. Dejar la pestaña abierta > 4 min con el toggle activo → `visto_at` se actualiza (keepalive).

- [ ] **Step 7: Commit**

```bash
git add app/api/asistencia/credencial/refresh/route.ts components/SessionGuard.tsx app/notificaciones/page.tsx app/api/sysacadws/login/route.ts
git commit -m "$(printf 'feat(asistencia): captura/borrado de la credencial cifrada del usuario\n\nSe guarda con el toggle "Avisar asistencia disponible" y se refresca en el\nkeepalive; se borra al desactivar o al cerrar sesion de Sysacad.\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

## Task 3: Endpoints de entrega al daemon

**Files:**
- Create: `app/api/asistencia/credenciales/route.ts`
- Create: `app/api/asistencia/credenciales/comisiones/route.ts`

**Interfaces:**
- Consumes: `decryptCred` de `@/lib/crypto`; `supabaseFetch` de `@/lib/supabase`; `process.env.NOTIFICATIONS_WEBHOOK_SECRET`; tabla `asistencia_credenciales`.
- Produces:
  - `GET /api/asistencia/credenciales` (header `x-worker-secret`) → `{ credenciales: [{ legajo: string, auth: string, comisiones: unknown[] | null, comisiones_at: string | null }] }`. `auth` = `base64(legajo:dni)` descifrado. Solo filas con `visto_at` de los últimos 30 días.
  - `POST /api/asistencia/credenciales/comisiones` (header `x-worker-secret`) → body `{ legajo: string, comisiones: unknown[] }` → `{ ok: true }`. `PATCH` de `comisiones`, `comisiones_at = now`, y `strikes` (incrementa si `comisiones` viene vacío, resetea a 0 si no).

- [ ] **Step 1: `GET /api/asistencia/credenciales`**

`app/api/asistencia/credenciales/route.ts`:

```ts
// El daemon de asistencia pide acá las credenciales de los usuarios con el
// aviso activo. El server descifra (SESSION_SECRET nunca sale del server) y
// devuelve base64("legajo:dni") listo para lib/asistenciaLegacy.ts:login().
// Gated por x-worker-secret = NOTIFICATIONS_WEBHOOK_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { decryptCred } from "@/lib/crypto";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIAS_VIGENCIA = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.NOTIFICATIONS_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-worker-secret") !== secret) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const desde = new Date(Date.now() - DIAS_VIGENCIA * 86400000).toISOString();
  let rows: Array<{
    legajo: string;
    cred_cifrada: string;
    comisiones: unknown[] | null;
    comisiones_at: string | null;
  }> = [];
  try {
    const res = await supabaseFetch(
      `asistencia_credenciales?select=legajo,cred_cifrada,comisiones,comisiones_at&visto_at=gte.${desde}`
    );
    if (res.ok) rows = await res.json();
  } catch {
    /* devolvemos lista vacía */
  }

  const credenciales = rows
    .map((r) => {
      const auth = decryptCred(r.cred_cifrada);
      if (!auth) return null;
      return { legajo: r.legajo, auth, comisiones: r.comisiones, comisiones_at: r.comisiones_at };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ credenciales });
}
```

- [ ] **Step 2: `POST /api/asistencia/credenciales/comisiones`**

`app/api/asistencia/credenciales/comisiones/route.ts`:

```ts
// El daemon reporta acá qué comisiones ve cada cuenta (mapa de descubrimiento).
// Gated por x-worker-secret. Maneja el contador de strikes (0 comisiones seguidas).

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFICATIONS_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-worker-secret") !== secret) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  let b: { legajo?: string; comisiones?: unknown[] };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }
  const legajo = String(b.legajo || "").trim();
  const comisiones = Array.isArray(b.comisiones) ? b.comisiones : [];
  if (!legajo) return NextResponse.json({ error: "falta legajo" }, { status: 400 });

  // strikes: +1 si vino vacío, 0 si trajo comisiones.
  let strikes = 0;
  if (comisiones.length === 0) {
    try {
      const res = await supabaseFetch(
        `asistencia_credenciales?select=strikes&legajo=eq.${encodeURIComponent(legajo)}`
      );
      if (res.ok) {
        const rows = (await res.json()) as { strikes: number }[];
        strikes = (rows[0]?.strikes ?? 0) + 1;
      }
    } catch {
      strikes = 1;
    }
    if (strikes >= 3) {
      console.warn(`[asistencia/comisiones] legajo ${legajo}: ${strikes} descubrimientos con 0 comisiones`);
    }
  }

  try {
    await supabaseFetch(`asistencia_credenciales?legajo=eq.${encodeURIComponent(legajo)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        comisiones,
        comisiones_at: new Date().toISOString(),
        strikes,
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npx eslint app/api/asistencia/credenciales/route.ts app/api/asistencia/credenciales/comisiones/route.ts`
Expected: typecheck PASS; eslint sin salida.

- [ ] **Step 4: Verificar con curl**

Con `next dev`, la tabla creada, y al menos una fila cargada por la Task 2 (o insertada a mano con un `cred_cifrada` real — se puede sacar de la cookie `sysacadws_auth` del navegador y cifrarla con un pequeño script, o simplemente probar el gate y el shape):

```bash
# 401 sin header
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/asistencia/credenciales
# -> 401

# con header
curl -s http://localhost:3000/api/asistencia/credenciales -H "x-worker-secret: $SECRET"
# -> {"credenciales":[{"legajo":"...","auth":"<base64>","comisiones":null,"comisiones_at":null}]}
#    y  atob(auth)  == "<legajo>:<dni>"

# escribir comisiones
curl -s -X POST http://localhost:3000/api/asistencia/credenciales/comisiones \
  -H "content-type: application/json" -H "x-worker-secret: $SECRET" \
  -d '{"legajo":"16686","comisiones":[{"id":"123","anio":"2026","especialidad":"5","plan":"2008","comision":"A","condicional":false,"habilitada":false,"nombre":"REDES"}]}'
# -> {"ok":true}   y en Supabase la fila tiene comisiones y comisiones_at, strikes=0

# vacío -> strike
curl -s -X POST http://localhost:3000/api/asistencia/credenciales/comisiones \
  -H "content-type: application/json" -H "x-worker-secret: $SECRET" \
  -d '{"legajo":"16686","comisiones":[]}'
# -> {"ok":true}   strikes pasa a 1
```

- [ ] **Step 5: Commit**

```bash
git add app/api/asistencia/credenciales
git commit -m "$(printf 'feat(asistencia): endpoints de entrega de credenciales al daemon (x-worker-secret)\n\nGET descifra y devuelve; POST /comisiones guarda el mapa de descubrimiento.\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

## Task 4: Daemon multi-cuenta (descubrimiento + dedup por comisión + loop)

**Files:**
- Modify: `scripts/asistencia-daemon/daemon.mts` (reescritura del cuerpo)
- Modify: `app/api/asistencia/worker/heartbeat/route.ts` (2 campos)

**Interfaces:**
- Consumes: `lib/asistenciaLegacy.ts` → `login(legajo: string, dni: string): Promise<string | null>` (devuelve string de cookies o null), `fetchApplyLeave(cookie: string): Promise<{ html: string; page: { autenticado: boolean; materias: AsistenciaMateria[] } }>`, tipo `AsistenciaMateria = { id, anio, especialidad, plan, comision, condicional, habilitada, nombre }`.
- Consumes: `GET /api/asistencia/credenciales` y `POST /api/asistencia/credenciales/comisiones` (Task 3); `POST /api/webhooks/asistencia` (ya existe, header `x-agent-secret`, body `{ source, activeOptions: {id,name}[] }`, responde `{ materias: [{materia, enviado, sent?}] }`); `POST /api/asistencia/worker/heartbeat` (ya existe, header `x-worker-secret`).
- Produces: `node scripts/asistencia-daemon/daemon.mts` que cubre N cuentas sin cuenta-bot local. Heartbeat incluye `cuentas` y `comisiones`.

- [ ] **Step 1: Reescribir `scripts/asistencia-daemon/daemon.mts`**

Reemplazar TODO el archivo por:

```ts
#!/usr/bin/env node
// Daemon de asistencia — corre en una PC de casa (o del autor).
//
// Fuente de cuentas: GET /api/asistencia/credenciales (credenciales cifradas de
// los usuarios con "Avisar asistencia disponible" activo; el server las
// descifra). Para cada cuenta:
//   1. descubrimiento: login al legacy (form) + parseo de TODAS las comisiones
//      del <select> de apply-leave.php -> POST /api/asistencia/credenciales/comisiones
//   2. dedup: se agrupa por comisión distinta y se elige 1 cuenta representante
//   3. chequeo (cada ~10 min, escalonado): por cada comisión distinta, con su
//      representante, GET apply-leave.php y por cada option data-habilitada="S"
//      -> POST /api/webhooks/asistencia (idempotente por día/materia).
//
// Rate-limit: >= 3s entre operaciones contra el legacy. Sesión PHP cacheada 20 min.
// Heartbeat con métricas cada 10s. Lo orquesta supervisor.mts.
//
// Se corre con el TypeScript nativo de Node 22.6+/24 (node daemon.mts).

import os from "node:os";
import { login as legacyLogin, fetchApplyLeave } from "../../lib/asistenciaLegacy.ts";
import { metricas } from "./metricas.mts";

const CONFIG = {
  appUrl: (process.env.CAMPUS_APP_URL || "https://campus-utn.vercel.app").replace(/\/$/, ""),
  secret: process.env.NOTIFICATIONS_WEBHOOK_SECRET || "",
  workerId: (process.env.ASISTENCIA_WORKER_NAME || os.hostname() || "asistencia-daemon").slice(0, 80),
  refrescoCuentasMs: 30 * 60_000,
  chequeoVentanaMs: 10 * 60_000,
  descubrimientoGapMs: 60_000,
  sesionTtlMs: 20 * 60_000,
  comisionesTtlMs: 7 * 86_400_000,
  legacyGapMs: 3_000,
};

type Materia = {
  id: string; anio: string; especialidad: string; plan: string;
  comision: string; condicional: boolean; habilitada: boolean; nombre: string;
};
type Cuenta = { legajo: string; auth: string; comisiones: Materia[] | null; comisionesAt: number };

const cuentas = new Map<string, Cuenta>();
const sesiones = new Map<string, { cookie: string; loginAt: number }>();
const representanteRoto = new Set<string>(); // legajos marcados como rotos en la vuelta actual
let ultimoHitLegacy = 0;
let ultimoLoginOk = false;

function ts() {
  return new Date().toISOString();
}

async function esperarTurnoLegacy() {
  const espera = ultimoHitLegacy + CONFIG.legacyGapMs - Date.now();
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimoHitLegacy = Date.now();
}

function claveComision(m: Materia) {
  return `${m.especialidad}|${m.plan}|${m.comision}|${m.id}`;
}

function authToLegajoDni(auth: string): [string, string] {
  const dec = Buffer.from(auth, "base64").toString("utf8");
  const i = dec.indexOf(":");
  return [dec.slice(0, i), dec.slice(i + 1)];
}

async function api(path: string, init: RequestInit = {}) {
  return fetch(`${CONFIG.appUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-worker-secret": CONFIG.secret, ...(init.headers || {}) },
  });
}

// ── Cuentas ────────────────────────────────────────────────────────────────
async function refrescarCuentas() {
  try {
    const r = await api("/api/asistencia/credenciales");
    if (!r.ok) {
      console.warn(`[${ts()}] GET credenciales -> HTTP ${r.status}`);
      return;
    }
    const j = (await r.json()) as {
      credenciales: { legajo: string; auth: string; comisiones: Materia[] | null; comisiones_at: string | null }[];
    };
    const vistos = new Set<string>();
    for (const c of j.credenciales) {
      vistos.add(c.legajo);
      const prev = cuentas.get(c.legajo);
      cuentas.set(c.legajo, {
        legajo: c.legajo,
        auth: c.auth,
        comisiones: c.comisiones ?? prev?.comisiones ?? null,
        comisionesAt: c.comisiones_at ? new Date(c.comisiones_at).getTime() : prev?.comisionesAt ?? 0,
      });
    }
    for (const legajo of [...cuentas.keys()]) if (!vistos.has(legajo)) cuentas.delete(legajo);
    console.log(`[${ts()}] cuentas: ${cuentas.size}`);
  } catch (e) {
    console.warn(`[${ts()}] refrescarCuentas: ${String((e as Error).message).slice(0, 120)}`);
  }
}

// ── Sesión PHP cacheada ────────────────────────────────────────────────────
async function sesionDe(legajo: string): Promise<string | null> {
  const cache = sesiones.get(legajo);
  if (cache && Date.now() - cache.loginAt < CONFIG.sesionTtlMs) return cache.cookie;
  const cuenta = cuentas.get(legajo);
  if (!cuenta) return null;
  const [lg, dni] = authToLegajoDni(cuenta.auth);
  await esperarTurnoLegacy();
  let cookie: string | null = null;
  try {
    cookie = await legacyLogin(lg, dni);
  } catch (e) {
    metricas.registrarError(`login ${legajo}: ${String((e as Error).message).slice(0, 80)}`);
  }
  ultimoLoginOk = !!cookie;
  metricas.setLoginOk(!!cookie);
  if (!cookie) return null;
  sesiones.set(legajo, { cookie, loginAt: Date.now() });
  return cookie;
}

// ── Descubrimiento ─────────────────────────────────────────────────────────
async function descubrir(legajo: string) {
  const cookie = await sesionDe(legajo);
  if (!cookie) return;
  let materias: Materia[] = [];
  try {
    await esperarTurnoLegacy();
    const { page } = await fetchApplyLeave(cookie);
    if (page.autenticado) materias = page.materias as Materia[];
  } catch (e) {
    metricas.registrarError(`descubrir ${legajo}: ${String((e as Error).message).slice(0, 80)}`);
    return;
  }
  const c = cuentas.get(legajo);
  if (c) {
    c.comisiones = materias;
    c.comisionesAt = Date.now();
  }
  try {
    await api("/api/asistencia/credenciales/comisiones", {
      method: "POST",
      body: JSON.stringify({ legajo, comisiones: materias }),
    });
  } catch {
    /* se reintenta la próxima vuelta */
  }
  console.log(`[${ts()}] descubrir ${legajo}: ${materias.length} comisión(es)`);
}

async function correrDescubrimientosPendientes() {
  const pendientes = [...cuentas.values()].filter(
    (c) => c.comisiones == null || Date.now() - c.comisionesAt > CONFIG.comisionesTtlMs
  );
  for (const c of pendientes) {
    await descubrir(c.legajo);
    await new Promise((r) => setTimeout(r, CONFIG.descubrimientoGapMs));
  }
}

// ── Dedup ──────────────────────────────────────────────────────────────────
function comisionesDistintas(): Map<string, { materia: Materia; representantes: string[] }> {
  const map = new Map<string, { materia: Materia; representantes: string[] }>();
  for (const c of cuentas.values()) {
    for (const m of c.comisiones ?? []) {
      const k = claveComision(m);
      const e = map.get(k);
      if (e) e.representantes.push(c.legajo);
      else map.set(k, { materia: m, representantes: [c.legajo] });
    }
  }
  return map;
}

// ── Chequeo ────────────────────────────────────────────────────────────────
async function chequear(entry: { materia: Materia; representantes: string[] }) {
  for (const legajo of entry.representantes) {
    if (representanteRoto.has(legajo)) continue;
    const cookie = await sesionDe(legajo);
    if (!cookie) {
      representanteRoto.add(legajo);
      continue;
    }
    try {
      await esperarTurnoLegacy();
      const t0 = Date.now();
      const { page } = await fetchApplyLeave(cookie);
      metricas.registrarRt(Date.now() - t0);
      metricas.registrarPoll();
      if (!page.autenticado) {
        sesiones.delete(legajo);
        representanteRoto.add(legajo);
        continue;
      }
      const abiertas = (page.materias as Materia[]).filter((m) => m.habilitada);
      for (const m of abiertas) {
        const r = await fetch(`${CONFIG.appUrl}/api/webhooks/asistencia`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agent-secret": CONFIG.secret },
          body: JSON.stringify({ source: "asistencia-daemon", activeOptions: [{ id: m.id, name: m.nombre }] }),
        });
        const jr = (await r.json().catch(() => ({}))) as {
          materias?: { materia: string; enviado: boolean; sent?: number }[];
        };
        for (const x of jr.materias ?? []) {
          metricas.agregarMateria(x.materia);
          if (x.enviado && x.sent) metricas.sumarPushes(x.sent);
        }
      }
      return; // esta comisión ya quedó chequeada con este representante
    } catch (e) {
      metricas.registrarError(`chequear ${legajo}: ${String((e as Error).message).slice(0, 80)}`);
      representanteRoto.add(legajo);
    }
  }
}

async function correrChequeos() {
  representanteRoto.clear();
  const distintas = [...comisionesDistintas().values()];
  if (distintas.length === 0) return;
  const paso = Math.max(1000, Math.floor(CONFIG.chequeoVentanaMs / (distintas.length + 1)));
  distintas.forEach((entry, i) => {
    setTimeout(() => void chequear(entry), i * paso);
  });
  console.log(`[${ts()}] chequeos: ${distintas.length} comisión(es), paso ${Math.round(paso / 1000)}s`);
}

// ── Heartbeat ──────────────────────────────────────────────────────────────
async function enviarHeartbeat(extra: Record<string, unknown> = {}) {
  if (!CONFIG.appUrl || !CONFIG.secret) return;
  try {
    await fetch(`${CONFIG.appUrl}/api/asistencia/worker/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": CONFIG.secret },
      body: JSON.stringify({
        id: CONFIG.workerId,
        estado: "activo",
        ...metricas.snapshot(),
        cuentas: cuentas.size,
        comisiones: comisionesDistintas().size,
        login_ok: ultimoLoginOk,
        ...extra,
      }),
    });
  } catch (e) {
    console.warn(`[${ts()}] heartbeat error: ${String((e as Error).message).slice(0, 100)}`);
  }
}

// ── Arranque ───────────────────────────────────────────────────────────────
console.log(`[${ts()}] daemon '${CONFIG.workerId}' -> ${CONFIG.appUrl}`);

async function ciclo() {
  await refrescarCuentas();
  await correrDescubrimientosPendientes();
  await correrChequeos();
}

void ciclo();
const cuentasTimer = setInterval(() => void refrescarCuentas(), CONFIG.refrescoCuentasMs);
const chequeoTimer = setInterval(() => {
  void correrDescubrimientosPendientes();
  void correrChequeos();
}, CONFIG.chequeoVentanaMs);
const hbTimer = setInterval(() => void enviarHeartbeat(), 10_000);
void enviarHeartbeat();

async function cerrar(signal: string) {
  clearInterval(cuentasTimer);
  clearInterval(chequeoTimer);
  clearInterval(hbTimer);
  console.log(`[${ts()}] cerrando (${signal})`);
  await enviarHeartbeat({ estado: "apagado", motivo: "cierre manual" });
  process.exit(0);
}
process.on("SIGINT", () => void cerrar("SIGINT"));
process.on("SIGTERM", () => void cerrar("SIGTERM"));
```

- [ ] **Step 2: Persistir `cuentas` y `comisiones` en el heartbeat route**

En `app/api/asistencia/worker/heartbeat/route.ts`, en el objeto `fila`, después de `pushes_hoy: n(b.pushes_hoy),` agregar:

```ts
    cuentas: n(b.cuentas),
    comisiones: n(b.comisiones),
```

- [ ] **Step 3: Chequeo de sintaxis + typecheck**

Run: `node --check scripts/asistencia-daemon/daemon.mts && npm run typecheck`
Expected: sin salida de `--check`; typecheck PASS (el `**/*.mts` está en `tsconfig` include).

Si `typecheck` falla por el import `../../lib/asistenciaLegacy.ts` (extensión `.ts` explícita): confirmar que `scripts/captcha-remoto/server.mts` importa igual (`../../lib/captchaSesion.ts`) — si ese patrón compila, este también. Si aun así falla, cambiar a `../../lib/asistenciaLegacy` sin extensión.

- [ ] **Step 4: Verificar contra `next dev` con una credencial real**

Prerrequisito: Task 2 cargó tu fila en `asistencia_credenciales` (toggle activo, sesión de Sysacad), y las tablas están en Supabase.

```powershell
cd scripts\asistencia-daemon
$env:CAMPUS_APP_URL = "http://localhost:3000"
$env:NOTIFICATIONS_WEBHOOK_SECRET = "<el de .env.local>"
$env:ASISTENCIA_WORKER_NAME = "pc-dev"
node daemon.mts
```

Expected en los logs:
- `daemon 'pc-dev' -> http://localhost:3000`
- `cuentas: 1`
- `descubrir <tu-legajo>: N comisión(es)` (login real al legacy — necesita internet y que la credencial sea válida)
- `chequeos: M comisión(es), paso Ns`
- En Supabase: tu fila de `asistencia_credenciales` con `comisiones` no-null y `comisiones_at` reciente, `strikes = 0`.
- En `/admin/dashboard` → tarjeta `pc-dev`: `Cuentas: 1`, `Comisiones: M`, `Login legacy: OK`, `RT` con valores.
- Los `GET` al legacy espaciados ≥ 3 s (mirar los timestamps de los logs).
- `Ctrl+C` → tarjeta pasa a "Apagada: cierre manual".

- [ ] **Step 5: Commit**

```bash
git add scripts/asistencia-daemon/daemon.mts app/api/asistencia/worker/heartbeat/route.ts
git commit -m "$(printf 'feat(asistencia): daemon multi-cuenta con dedup por comision y rate-limit\n\nFuente = /api/asistencia/credenciales. Descubre comisiones por cuenta,\ndeduplica, chequea 1 representante por comision cada ~10min escalonado,\nreusando lib/asistenciaLegacy.ts y la sesion PHP cacheada.\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

## Task 5: Monitor + limpieza del modelo de cuenta-bot

**Files:**
- Modify: `app/admin/dashboard/_components/AsistenciaWorkersSection.tsx`
- Modify: `scripts/asistencia-daemon/start.ps1`
- Modify: `scripts/asistencia-daemon/asistencia-worker.service`
- Modify: `scripts/asistencia-daemon/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `GET /api/admin/asistencia-workers` (ya existe) ahora devuelve filas con `cuentas` y `comisiones` (Task 4 Step 2 las persiste).
- Produces: la sección del dashboard muestra `Cuentas` y `Comisiones`; `start.ps1` ya no exige `credenciales.txt`.

- [ ] **Step 1: Mostrar `Cuentas` y `Comisiones` en la sección**

En `app/admin/dashboard/_components/AsistenciaWorkersSection.tsx`:

1. En `type Worker`, después de `pushes_hoy: number;` agregar:
   ```ts
   cuentas: number;
   comisiones: number;
   ```
2. En la grilla de `<Dato>` (dentro del `<div className="px-4 py-3 grid ...">`), después de `<Dato k="Materias hoy" v={w.materias_hoy || "—"} />` y `<Dato k="Pushes hoy" v={w.pushes_hoy} />`, agregar:
   ```tsx
   <Dato k="Cuentas" v={w.cuentas ?? 0} />
   <Dato k="Comisiones" v={w.comisiones ?? 0} />
   ```

- [ ] **Step 2: `start.ps1` sin `credenciales.txt` ni `-PollMs`**

En `scripts/asistencia-daemon/start.ps1`:

1. En `param(...)` borrar la línea `[int]$PollMs = 0`.
2. Borrar el bloque entero de credenciales:
   ```powershell
   # 2) Credenciales de la cuenta-bot del legacy (2 lineas: usuario / password)
   $credFile = Join-Path $dir "credenciales.txt"
   if (-not (Test-Path $credFile)) {
     Write-Host "FALTA scripts/asistencia-daemon/credenciales.txt - 2 lineas: usuario y password de la cuenta-bot."
     exit 1
   }
   $cred = Get-Content $credFile
   $ASIS_USER = ($cred | Select-Object -First 1).Trim()
   $ASIS_PASS = ($cred | Select-Object -Skip 1 -First 1).Trim()
   ```
3. En el bloque `# 6) Env para el supervisor`, borrar las líneas:
   ```powershell
   $env:ASISTENCIA_USER = $ASIS_USER
   $env:ASISTENCIA_PASSWORD = $ASIS_PASS
   if ($PollMs -gt 0) { $env:ASISTENCIA_POLL_MS = "$PollMs" }
   ```
4. En el header de comentarios y en el bloque `Write-Host` de "Setup (una vez)", cambiar el paso 3 ("Poner usuario y password de la cuenta-bot...") por: `#   3) Correr scripts/asistencia-credenciales.sql y el ALTER de asistencia_workers en Supabase`. Y quitar la línea `Write-Host "   Poll: ..."`.

- [ ] **Step 3: `.service` sin las env de cuenta-bot**

En `scripts/asistencia-daemon/asistencia-worker.service`, borrar las 3 líneas:
```
Environment=ASISTENCIA_USER=PEGAR_USUARIO_BOT
Environment=ASISTENCIA_PASSWORD=PEGAR_PASSWORD_BOT
Environment=ASISTENCIA_POLL_MS=120000
```

- [ ] **Step 4: `README.md` sin cuenta-bot**

En `scripts/asistencia-daemon/README.md`, reemplazar la sección "## Setup (una vez)" y "## Mover a otra PC" por:

```markdown
## Setup (una vez)

1. En Supabase → SQL Editor, correr `scripts/asistencia-workers.sql`,
   `scripts/asistencia-avisos-log.sql` y `scripts/asistencia-credenciales.sql`.
2. Crear `scripts/asistencia-daemon/secret.txt` con el **mismo**
   `NOTIFICATIONS_WEBHOOK_SECRET` que está en Vercel.

No hay cuenta-bot. La cobertura sale sola de los usuarios que activan
"Avisar asistencia disponible" en `/notificaciones`: la app guarda su credencial
de Sysacad cifrada y el daemon la usa para ver sus comisiones.

## Mover a otra PC

Clonar el repo, copiar `secret.txt` y `app-url.txt`, tener Node 22.6+,
`.\start.ps1 -AppUrl <url> -Name <nombre>`.
```

Y borrar de "## Uso" la mención a "completar `credenciales.txt`".

- [ ] **Step 5: `.gitignore`**

En `.gitignore`, borrar la línea:
```
scripts/asistencia-daemon/credenciales.txt
```
(dejar `app-url.txt` y `secret.txt`).

- [ ] **Step 6: Typecheck + lint + parse**

Run:
```
npm run typecheck && npx eslint app/admin/dashboard/_components/AsistenciaWorkersSection.tsx
```
Expected: typecheck PASS; eslint sin salida.

Run (PowerShell parse):
```
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'scripts/asistencia-daemon/start.ps1'), [ref]$null, [ref]$null)
```
Expected: sin errores.

- [ ] **Step 7: Verificar**

- `/admin/dashboard` con el daemon de la Task 4 corriendo → la tarjeta muestra `Cuentas` y `Comisiones` con números reales.
- `git grep -n "credenciales.txt\|ASISTENCIA_USER\|ASISTENCIA_PASSWORD\|ASISTENCIA_POLL_MS" scripts/ .gitignore` → sin resultados (fuera de `.waylog/`).

- [ ] **Step 8: Commit**

```bash
git add app/admin/dashboard/_components/AsistenciaWorkersSection.tsx scripts/asistencia-daemon/start.ps1 scripts/asistencia-daemon/asistencia-worker.service scripts/asistencia-daemon/README.md .gitignore
git commit -m "$(printf 'feat(asistencia): monitor muestra cuentas/comisiones; retira el modelo de cuenta-bot\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')"
```

---

## Self-Review

**1. Spec coverage:**

| Sección del spec | Task |
|---|---|
| Componente 1 — tabla `asistencia_credenciales` | Task 1 |
| Componente 1 — `POST /api/asistencia/credencial/refresh` | Task 2 Step 1 |
| Componente 1 — hook en `SessionGuard` | Task 2 Step 2 |
| Componente 1 — hook + subtexto en `/notificaciones` | Task 2 Step 3 |
| Componente 1 — borrado en `DELETE /api/sysacadws/login` | Task 2 Step 4 |
| Componente 2 — daemon: refrescarCuentas, descubrir, dedup, chequeo, rate-limit, caché sesión | Task 4 Step 1 |
| Componente 2 — métricas `cuentas`/`comisiones`/`login_ok` | Task 4 Step 1 (heartbeat) + Step 2 (route) |
| Componente 2 — reusar `lib/asistenciaLegacy.ts` (form login) | Task 4 Step 1 (imports) |
| Componente 3 — `GET /api/asistencia/credenciales` | Task 3 Step 1 |
| Componente 3 — `POST /api/asistencia/credenciales/comisiones` + strikes | Task 3 Step 2 |
| Componente 4 — 2 columnas en `asistencia_workers` | Task 1 Steps 2–3 |
| Componente 4 — heartbeat route persiste los 2 campos | Task 4 Step 2 |
| Componente 4 — `AsistenciaWorkersSection` muestra los 2 `Dato` | Task 5 Step 1 |
| Componente 5 — `start.ps1` sin `credenciales.txt` / `-PollMs` | Task 5 Step 2 |
| Componente 5 — `.service` sin env de cuenta-bot | Task 5 Step 3 |
| Componente 5 — `README.md` sin cuenta-bot | Task 5 Step 4 |
| Componente 5 — `.gitignore` sin `credenciales.txt` | Task 5 Step 5 |
| Seguridad / Errores / Testing | Global Constraints + pasos de verificación de cada Task |

Sin huecos.

**2. Placeholder scan:** sin "TBD"/"TODO"/"como Task N". Todos los pasos de código traen el código real. Los archivos que se editan traen el fragmento exacto a insertar/borrar y dónde.

**3. Type consistency:**
- `Materia` en `daemon.mts` (Task 4) = campos `{ id, anio, especialidad, plan, comision, condicional, habilitada, nombre }`, idéntico a `AsistenciaMateria` de `lib/asistenciaLegacy.ts` que consume. `comisiones` jsonb (Task 1) guarda ese array; `POST /comisiones` (Task 3) lo acepta como `unknown[]`; `GET /credenciales` (Task 3) lo devuelve como `unknown[] | null` y el daemon lo castea a `Materia[]`. Coherente.
- `claveComision` = `` `${especialidad}|${plan}|${comision}|${id}` `` — misma en Global Constraints y en `daemon.mts`.
- `auth` = `base64(legajo:dni)`: `encryptCred(auth)` guarda (Task 2), `decryptCred` devuelve (Task 3 `GET`), `authToLegajoDni` / `atob` lo parte (Task 4). Coherente.
- Heartbeat: `daemon.mts` manda `cuentas`, `comisiones`, `login_ok` (Task 4 Step 1); el route los lee con `n(b.cuentas)`, `n(b.comisiones)` (Task 4 Step 2) y `login_ok` ya lo leía; la columna existe (Task 1); `type Worker` + `<Dato>` los consumen (Task 5 Step 1). Coherente.
- `/api/webhooks/asistencia` respuesta `{ materias: [{ materia, enviado, sent? }] }` — el daemon lee `x.materia` / `x.enviado` / `x.sent` (Task 4), igual que la implementación ya en la rama. Coherente.

Sin inconsistencias.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-03-asistencia-credenciales-por-usuario.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
