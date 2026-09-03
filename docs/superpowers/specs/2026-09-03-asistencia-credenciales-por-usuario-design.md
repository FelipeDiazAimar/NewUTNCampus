# Asistencia: cobertura total vía credenciales cifradas por usuario

Fecha: 2026-09-03
Estado: aprobado (diseño) — listo para plan de implementación.

Continúa el trabajo de `docs/superpowers/specs/2026-09-02-notificaciones-asistencia-daemon-design.md`
(rama `feat/notificaciones-asistencia-daemon`).

## Objetivo

Que el daemon de asistencia detecte la asistencia abierta de **todas las
materias que cursa cualquier usuario de la app**, sin mantener a mano una
cuenta-bot inscripta en todo.

Para eso: cuando un usuario tiene activado "Avisar asistencia disponible", la app
guarda su credencial de Sysacad (`legajo:DNI`) **cifrada** en Supabase. El daemon
la usa para loguearse al "Control de Asistencias" legacy como ese usuario, ve sus
comisiones, y las vigila. Se deduplica por comisión (dos alumnos de la misma
comisión ven el mismo `id_materia`) y se rate-limita para no hacer que la
facultad bloquee la IP.

## Contexto: qué ya existe

- **`lib/crypto.ts`** — `encryptCred(plain)` / `decryptCred(token)`: AES-256-GCM,
  clave derivada por scrypt de `SESSION_SECRET`. Ya se usa para el "mantener
  sesión iniciada" de Sysacad.
- **Login de Sysacad** (`app/api/sysacadws/login/route.ts`): el usuario entra con
  `legajo` + `dni`; el server valida contra el WS y guarda
  `sysacadws_auth = base64(legajo:dni)` en una **cookie httpOnly** (comentario en
  el código: "la credencial de Sysacad (legajo:DNI) no expira"). `DELETE` de esa
  ruta = logout de Sysacad, borra la cookie.
- **El legacy de asistencia** (`asistencia.frsfco.utn.edu.ar:4443`,
  `lib/asistenciaLegacy.ts`) autentica con `legajo` + `password = DNI` — **las
  mismas credenciales que Sysacad**. `apply-leave.php` devuelve el `<select
  name="id_materia">` con una `<option>` por comisión que cursa la cuenta, cada
  una con `data-anio`, `data-especialidad`, `data-plan`, `data-comision`,
  `data-condicional`, `data-habilitada` ("S" = asistencia abierta ahora).
- **`SessionGuard`** (`components/SessionGuard.tsx`): keepalive del Campus cada
  4 min; en cada ping exitoso ya hace un `fetch("/api/notifications/push-subscription/session", {method:"POST"})`
  fire-and-forget para refrescar la sesión Moodle en las suscripciones push.
- **`perfil_notificaciones`** (`email` único, `notificaciones_globales_activas`,
  `notificar_asistencia`). `/notificaciones` lo auto-crea con
  `notificar_asistencia: true`. El toggle "Avisar asistencia disponible" llama a
  `POST /api/notifications` con `action: "updateProfile"`.
- **Del spec anterior (rama actual):**
  - `POST /api/webhooks/asistencia` — recibe `{ activeOptions: {id,name}[] }` con
    `x-agent-secret`, hace broadcast **idempotente por (día, materia)** vía la
    tabla `asistencia_avisos_log`. **No se toca.**
  - `scripts/asistencia-daemon/` — `daemon.mts` (poll + webhook + heartbeat),
    `supervisor.mts`, `start.ps1`, etc. Hoy el daemon usa **una** cuenta de
    `credenciales.txt` (`ASISTENCIA_USER` / `ASISTENCIA_PASSWORD`).
  - `asistencia_workers` + `/api/asistencia/worker/heartbeat` +
    `/api/admin/asistencia-workers` + `AsistenciaWorkersSection.tsx` — monitor.
  - `x-worker-secret` = `NOTIFICATIONS_WEBHOOK_SECRET` para los endpoints del
    worker.

## Decisiones tomadas (brainstorming)

1. **Opt-in ligado al toggle que ya existe.** Si `notificar_asistencia` (y el
   global) están on, la app guarda la credencial cifrada. El toggle
   "Avisar asistencia disponible" pasa a llevar también el consentimiento de
   "Campus guarda tu credencial cifrada y revisa la asistencia por vos"
   (subtexto explícito en `/notificaciones`).
2. **Dedup por comisión + sesión PHP cacheada.** El daemon descubre qué
   comisiones ve cada cuenta, después chequea **una cuenta por comisión
   distinta** cada ~10 min, reusando la cookie de sesión. Rate-limit global de
   ≥ 3 s entre requests al legacy.
3. **Reemplaza la cuenta-bot.** El daemon deja de usar `credenciales.txt`; su
   única fuente son las credenciales cifradas en Supabase.
4. **Captura al togglear + refresco por el keepalive de `SessionGuard`.**
5. **Entrega vía endpoint del server gated por `x-worker-secret`.** El server
   descifra (`SESSION_SECRET` nunca sale del server) y devuelve `legajo:DNI` en
   texto plano al daemon por TLS (inherente: el daemon debe autenticar como el
   usuario).

## Diseño

### Componente 1 — Modelo de datos + captura

**Tabla nueva** `scripts/asistencia-credenciales.sql` (+ al consolidado
`scripts/notifications.sql`):

```sql
create table if not exists public.asistencia_credenciales (
  legajo         text primary key,       -- plano (está en el carnet, ya es path param del WS)
  cred_cifrada   text not null,          -- encryptCred("<legajo>:<dni>")  (= el valor de sysacadws_auth)
  email          text,                   -- username de Moodle, linkea con perfil_notificaciones
  comisiones     jsonb,                  -- [{id_materia, anio_academico, id_especialidad, id_plan, comision, nombre}]; null hasta el 1er descubrimiento
  comisiones_at  timestamptz,            -- cuándo se refrescó el mapa
  strikes        integer not null default 0,  -- descubrimientos consecutivos con 0 comisiones
  visto_at       timestamptz not null default now(),  -- último refresh desde la app
  creado_at      timestamptz not null default now()
);

create index if not exists asistencia_credenciales_visto_idx
  on public.asistencia_credenciales (visto_at desc);

alter table public.asistencia_credenciales enable row level security;
```

**`POST /api/asistencia/credencial/refresh`** — `app/api/asistencia/credencial/refresh/route.ts`,
`runtime = "nodejs"`:

1. Lee cookies `moodle_user` (para el email) y `sysacadws_auth`.
2. Si falta `sysacadws_auth` → `NextResponse.json({ ok: false }, { status: 200 })`
   (silencioso — el usuario no tiene sesión de Sysacad todavía).
3. `legajo = atob(sysacadws_auth).split(":")[0]`. Si no parsea → `200` silencioso.
4. `email` = `JSON.parse(moodle_user).username` (o `userid` como fallback).
5. Busca el perfil: `GET perfil_notificaciones?email=eq.<email>&select=notificar_asistencia,notificaciones_globales_activas`.
   - Si no hay perfil, o `notificar_asistencia = false`, o
     `notificaciones_globales_activas = false` →
     `DELETE asistencia_credenciales?legajo=eq.<legajo>` (best-effort) y `200`.
   - Si están las dos on →
     `POST asistencia_credenciales?on_conflict=legajo` con
     `Prefer: resolution=merge-duplicates,return=minimal`, body
     `{ legajo, cred_cifrada: encryptCred(sysacadws_auth), email, visto_at: now }`.
     (No pisa `comisiones` / `comisiones_at` / `strikes` — merge-duplicates
     actualiza solo las columnas enviadas.)
6. Cualquier throw en el medio → `catch` → `200` igual. **Nunca** rompe el
   keepalive.

**`components/SessionGuard.tsx`** — en el bloque `if (k === "campus")` del
keepalive, al lado del `fetch("/api/notifications/push-subscription/session", …)`
existente, agregar:

```ts
fetch("/api/asistencia/credencial/refresh", { method: "POST" }).catch(() => {});
```

**`app/notificaciones/page.tsx`:**
- En el handler del toggle "Avisar asistencia disponible" (el `updateProfile({ notificar_asistencia: next })`),
  después del `await updateProfile(...)` agregar:
  `fetch("/api/asistencia/credencial/refresh", { method: "POST" }).catch(() => {});`
  Igual en el master switch cuando reactiva todo.
- En la `<Row label="Avisar asistencia disponible">` de la sección Asistencia,
  agregar un subtexto (mismo patrón visual que el resto): *"Para avisarte, Campus
  guarda tu credencial de Sysacad cifrada y revisa la asistencia por vos."*

**`app/api/sysacadws/login/route.ts`** — en `DELETE`, antes de responder, leer
`sysacadws_auth` de `req.cookies`, sacar el `legajo`, y
`supabaseFetch("asistencia_credenciales?legajo=eq.<legajo>", { method: "DELETE" }).catch(() => {})`.
(Import de `supabaseFetch` si no está.)

### Componente 2 — Daemon: descubrimiento + dedup + loop

**`scripts/asistencia-daemon/daemon.mts`** — reescritura del cuerpo del poll.
Se quita todo lo de `ASISTENCIA_USER` / `ASISTENCIA_PASSWORD` /
`ASISTENCIA_COOKIE` / `loginIfNeeded` de cuenta única. Nuevo flujo:

**Config:** `CAMPUS_APP_URL`, `NOTIFICATIONS_WEBHOOK_SECRET` (para `x-worker-secret`
y `x-agent-secret`), `ASISTENCIA_BASE_URL`, `ASISTENCIA_WORKER_NAME`,
`ASISTENCIA_WORKER_VERSION`. Ya no hay credenciales locales.

**Estado en memoria:**
- `cuentas: Map<legajo, { auth: string; comisiones: Comision[] | null; comisiones_at: number }>`
- `sesiones: Map<legajo, { jar: CookieJar; loginAt: number }>` — caché de sesión PHP.
- `strikes: Map<legajo, number>` (espejo local del `strikes` de la fila).
- `ultimoHitLegacy: number` — para el rate-limit.

**Rate-limit:** `async function esperarTurnoLegacy()` — garantiza ≥ 3000 ms entre
cualquier par de requests salientes al `ASISTENCIA_BASE_URL`. Toda llamada al
legacy pasa por acá.

**`refrescarCuentas()`** (al arranque y cada 30 min):
- `GET {APP_URL}/api/asistencia/credenciales` con `x-worker-secret`.
- Respuesta `[{ legajo, auth, comisiones, comisiones_at }]`. Actualiza el `Map`
  `cuentas` (agrega nuevas, quita las que ya no vienen, refresca `comisiones`).

**`descubrir(legajo)`** (throttled: máximo 1 por minuto, cola simple):
- `esperarTurnoLegacy()`, login al legacy: `atob(auth).split(":")` → `[legajo, dni]`,
  y **login por formulario** (`GET /index.php` para tomar la cookie PHP + hidden
  fields, `POST /index.php` con `legajo` + `password=dni`), igual que el
  `agent.js` viejo y `lib/asistenciaLegacy.ts`. **No** es HTTP Basic (eso es solo
  para el WS de Sysacad). Después `GET /apply-leave.php`.
- Parsea **todas** las `<option>` del `<select name="id_materia">` (habilitadas o
  no, sin `disabled`) → `Comision[]` con `{ id_materia, anio_academico,
  id_especialidad, id_plan, comision, nombre }` de los `data-*` y el texto.
- `POST {APP_URL}/api/asistencia/credenciales/comisiones` con
  `{ legajo, comisiones }` y `x-worker-secret`.
- Actualiza `cuentas.get(legajo).comisiones`.
- Si `comisiones.length === 0` y el login parecía OK → cuenta un strike (la app
  lo persiste); si el login falló → `login_ok = false` en métricas, se reintenta
  la próxima vuelta.
- Se llama para cuentas con `comisiones == null` o `comisiones_at` > 7 días.

**`comisionesDistintas()`:** de todos los `cuentas[*].comisiones`, arma un
`Map<claveComision, { comision: Comision; representantes: legajo[] }>` con
`claveComision = \`${id_especialidad}|${id_plan}|${comision}|${id_materia}\``.

**`chequear(claveComision)`** (loop cada 10 min, **escalonado**: los chequeos se
reparten en la ventana con `setTimeout` incrementales, no todos juntos):
- Elige el primer `representante` cuya sesión no esté marcada como rota.
- Sesión: si `sesiones.get(legajo)` tiene < 20 min → reusa el `jar`; si no,
  `esperarTurnoLegacy()` + re-login, guarda `loginAt = now`.
- `esperarTurnoLegacy()` + `GET /apply-leave.php`.
- Parsea las `<option data-habilitada="S">`. Por cada una →
  `POST {APP_URL}/api/webhooks/asistencia` con
  `{ source: "asistencia-daemon", activeOptions: [{ id: id_materia, name }] }` y
  `x-agent-secret`. (Endpoint sin cambios; dedup por día/materia ya existe.)
- Suma `result.sent` de la respuesta a `pushes_hoy` (métricas).
- Si el `GET` falla / devuelve login → marca ese representante como roto para
  esta vuelta y reintenta con el siguiente; si no queda ninguno → `errores++`,
  backoff de esa comisión (saltear 1-2 vueltas).

**Métricas (heartbeat, además de las que ya manda):**
- `cuentas` = `cuentas.size`
- `comisiones` = `comisionesDistintas().size`
- `login_ok` = el último login (descubrimiento o chequeo) fue exitoso.
- `rt_*` = duración del `GET /apply-leave.php` (igual que hoy).
- `materias_hoy`, `pushes_hoy` = igual que hoy, alimentado por la respuesta del
  webhook.

**Timers:** `refrescarCuentas` cada 30 min; un scheduler que cada 10 min encola
los `chequear(...)` de todas las comisiones distintas escalonados; `descubrir`
sale de una cola procesada 1/min; heartbeat cada 10 s (sin cambios).

### Componente 3 — Endpoints de entrega

**`GET /api/asistencia/credenciales`** — `app/api/asistencia/credenciales/route.ts`,
`runtime = "nodejs"`, `dynamic = "force-dynamic"`:
- `if (!secret || req.headers.get("x-worker-secret") !== process.env.NOTIFICATIONS_WEBHOOK_SECRET) → 401`.
- `GET asistencia_credenciales?select=legajo,cred_cifrada,comisiones,comisiones_at&visto_at=gte.<hace 30 días ISO>`.
- Mapea: `{ legajo, auth: decryptCred(cred_cifrada), comisiones, comisiones_at }`.
  Si `decryptCred` devuelve `null` (blob corrupto) → se omite la fila.
- Responde `{ credenciales: [...] }`.

**`POST /api/asistencia/credenciales/comisiones`** — mismo archivo o
`app/api/asistencia/credenciales/comisiones/route.ts`, mismo gate:
- Body `{ legajo: string, comisiones: Comision[] }`.
- `PATCH asistencia_credenciales?legajo=eq.<legajo>` con
  `{ comisiones, comisiones_at: now, strikes: comisiones.length === 0 ? (strike+1) : 0 }`.
  Para el incremento condicional: primero `GET ...select=strikes`, calcular, y
  `PATCH`. Si `strikes >= 3` → solo se loguea (`console.warn`), **no** se borra ni
  nulea la credencial (evita perderla por un hipo del legacy).
- `200 { ok: true }`.

### Componente 4 — Monitor

**`scripts/asistencia-workers.sql`** + bloque en `scripts/notifications.sql`:
agregar dos columnas a `asistencia_workers`:

```sql
alter table public.asistencia_workers
  add column if not exists cuentas integer not null default 0,
  add column if not exists comisiones integer not null default 0;
```

(En `asistencia-workers.sql`, que se corre en instalaciones nuevas, sumarlas
directo a la definición de la tabla.)

**`app/api/asistencia/worker/heartbeat/route.ts`:** agregar `cuentas: n(b.cuentas)`
y `comisiones: n(b.comisiones)` al objeto `fila`.

**`app/admin/dashboard/_components/AsistenciaWorkersSection.tsx`:** en el `type
Worker` sumar `cuentas: number; comisiones: number;`, y en la grilla de `Dato`
agregar `<Dato k="Cuentas" v={w.cuentas} />` y
`<Dato k="Comisiones" v={w.comisiones} />`.

### Componente 5 — Limpieza del modelo viejo

- `scripts/asistencia-daemon/start.ps1`: quitar la exigencia de
  `credenciales.txt` (borrar ese bloque `if (-not (Test-Path $credFile))` y las
  vars `ASISTENCIA_USER` / `ASISTENCIA_PASSWORD`). Deja `secret.txt` +
  `app-url.txt` + params `-Name` / `-AppUrl` / `-PollMs` (aunque `-PollMs` ahora
  no aplica al loop viejo; se puede dejar como override de la ventana de chequeo
  o quitar — **elegido:** quitar `-PollMs`).
- `scripts/asistencia-daemon/asistencia-worker.service`: quitar
  `Environment=ASISTENCIA_USER=...` y `...PASSWORD=...` y `...POLL_MS=...`.
- `scripts/asistencia-daemon/README.md`: reescribir "Setup" y "credenciales" —
  ya no hay cuenta-bot; la cobertura viene de los usuarios que tengan
  "Avisar asistencia disponible" activo. El único setup es `secret.txt` +
  `-AppUrl` + correr los `.sql` nuevos.
- `.gitignore`: la línea `scripts/asistencia-daemon/credenciales.txt` queda (es
  inofensiva) o se quita — **elegido:** quitarla junto con la mención en el
  README.

## Variables de entorno

Sin env vars nuevas. `SESSION_SECRET` y `NOTIFICATIONS_WEBHOOK_SECRET` ya están
en Vercel. En la PC del daemon: `CAMPUS_APP_URL` + `NOTIFICATIONS_WEBHOOK_SECRET`
(de `secret.txt`) + `ASISTENCIA_WORKER_NAME`. **Ya no** `ASISTENCIA_USER` /
`ASISTENCIA_PASSWORD`.

## Seguridad

- **Cifrado:** `encryptCred` (AES-256-GCM, clave scrypt de `SESSION_SECRET`). Es
  el mismo mecanismo que el proyecto ya usa para "mantener sesión iniciada".
- **Blast radius:**
  - Dump de la base solo → ciphertext inútil.
  - Dump **+** `SESSION_SECRET` filtrado → `legajo:DNI` de todos los usuarios con
    el aviso activo. Misma clase de riesgo que el store actual de `sysacadws_auth`
    (que hoy va en cookie httpOnly sin cifrar), pero agregado.
  - Mitigaciones: `SESSION_SECRET` solo en env de Vercel; poda a 30 días por
    `visto_at`; borrado en logout de Sysacad y en toggle-off; `GET
    /api/asistencia/credenciales` gated por `x-worker-secret`, devuelve el mínimo.
- **La PC del daemon** recibe `legajo:DNI` en texto plano por TLS — inherente (el
  daemon debe autenticar como el usuario). La PC tiene que ser de confianza.
- **DNI:** semi-público (carnet, usuario en múltiples sistemas). Funciona de
  password del legacy → se trata como credencial, no grado bancario.
- Nada llega al bundle del cliente: endpoints server-only, credenciales en
  cookies httpOnly / Supabase.

## Manejo de errores

| Situación | Comportamiento |
|---|---|
| `credencial/refresh` sin `sysacadws_auth` | `200` silencioso, no hace nada |
| `credencial/refresh` throw interno | `catch` → `200`, no rompe el keepalive |
| Perfil con asistencia off | `DELETE` de la fila (opt-out) |
| Daemon: login de una cuenta falla | se saltea, se prueba otra representante; `errores++` |
| Daemon: legacy 5xx / timeout | backoff de esa comisión (1-2 vueltas) |
| Descubrimiento da 0 comisiones 3 veces | `strikes >= 3` → solo `console.warn`, no se borra la credencial |
| `GET /api/asistencia/credenciales` vacío | daemon idlea, sigue mandando heartbeat |
| `decryptCred` devuelve null | esa fila se omite de la respuesta |

## Testing (manual, no hay suite)

1. `npm run typecheck` + `npx eslint <archivos nuevos/cambiados>` sin errores
   nuevos.
2. **Captura:** con sesión de Moodle + Sysacad, activar "Avisar asistencia
   disponible" en `/notificaciones` → fila en `asistencia_credenciales` con
   `email`, `visto_at`, `cred_cifrada` no-null. Desactivar → fila borrada.
   Logout de Sysacad (`DELETE /api/sysacadws/login`) → fila borrada.
3. **Keepalive:** dejar la pestaña abierta > 5 min → `visto_at` se actualiza.
4. **Entrega:** `curl -H "x-worker-secret: $SECRET" http://localhost:3000/api/asistencia/credenciales`
   → `{ credenciales: [{ legajo, auth: "<base64>", comisiones: null, ... }] }`.
   Sin header → `401`. `atob(auth)` = `"<legajo>:<dni>"`.
5. **Daemon:** contra `next dev`, con una credencial real cargada → logs de
   `refrescarCuentas` → `descubrir` (login legacy OK, `POST .../comisiones`) →
   `chequear` escalonado con ≥ 3 s entre hits. Verificar `comisiones` no-null en
   la fila y `strikes = 0`.
6. **Detección:** con una asistencia real abierta (o forzando con una cuenta) →
   `chequear` → `POST /api/webhooks/asistencia` → push; segunda vuelta no
   re-notifica (dedup por día/materia).
7. **Monitor:** `/admin/dashboard` → tarjeta del worker muestra `Cuentas: N`,
   `Comisiones: M`.
8. **PWA iOS + Android:** con un dispositivo suscrito, el aviso real llega y
   abre `/asistencia`.

## Archivos

| Acción | Archivo |
|---|---|
| nuevo | `scripts/asistencia-credenciales.sql` |
| editar | `scripts/notifications.sql` (anexar `asistencia_credenciales` + 2 columnas de `asistencia_workers`) |
| editar | `scripts/asistencia-workers.sql` (2 columnas: `cuentas`, `comisiones`) |
| nuevo | `app/api/asistencia/credencial/refresh/route.ts` |
| nuevo | `app/api/asistencia/credenciales/route.ts` (`GET`) |
| nuevo | `app/api/asistencia/credenciales/comisiones/route.ts` (`POST`) |
| editar | `components/SessionGuard.tsx` |
| editar | `app/notificaciones/page.tsx` |
| editar | `app/api/sysacadws/login/route.ts` (`DELETE` borra la fila) |
| editar | `app/api/asistencia/worker/heartbeat/route.ts` (`cuentas`, `comisiones`) |
| editar | `app/admin/dashboard/_components/AsistenciaWorkersSection.tsx` (2 `Dato`) |
| editar | `scripts/asistencia-daemon/daemon.mts` (reescritura del flujo) |
| editar | `scripts/asistencia-daemon/start.ps1` (sin `credenciales.txt`) |
| editar | `scripts/asistencia-daemon/asistencia-worker.service` (sin `ASISTENCIA_USER/PASSWORD/POLL_MS`) |
| editar | `scripts/asistencia-daemon/README.md` (sin cuenta-bot) |
| editar | `.gitignore` (quita la línea de `credenciales.txt`) |

**No se tocan:** `app/api/webhooks/asistencia/route.ts`, `asistencia_avisos_log`,
`supervisor.mts`, `metricas.mts` (salvo agregar los 2 campos al `snapshot()`),
`install-tarea.ps1`.

## Fuera de alcance

- Cuenta de bedel / multi-fuente (descartado: la fuente son los usuarios).
- Rotación de `SESSION_SECRET` (proceso operativo, no código).
- Notificación por Telegram para asistencia.
- Filtrar el broadcast por materia por usuario (el aviso sigue siendo a todos los
  que tienen `notificar_asistencia` on; la novedad es solo la **cobertura** de
  detección).
