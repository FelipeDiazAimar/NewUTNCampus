# Notificaciones de asistencia — daemon local + pruebas desde admin

Fecha: 2026-09-02 (revisado 2026-09-03 para espejar el patrón del captcha worker
ya mergeado en `main`)
Estado: aprobado (diseño) — listo para plan de implementación.

## Objetivo

Que cuando el sistema viejo de la facultad (`asistencia.frsfco.utn.edu.ar:4443`)
habilite la asistencia de una materia, a **todos los usuarios con notificaciones
push activas y el aviso de asistencia habilitado** les llegue una notificación a
la PWA (iPhone y Android) diciendo en qué materia se abrió, y que al tocarla se
abra `/asistencia`.

El proceso que vigila corre en una PC del autor y se puede clonar/mover a otra
PC sin reescribir nada ni duplicar avisos.

Incluye botones de prueba en `/admin/dashboard` para disparar una push de test a
un usuario concreto (por email) o a todos.

Incluye un **monitor en `/admin/dashboard`**: si la PC que corre el daemon está
conectada, hace cuánto, uptime, polls hechos, tiempo de respuesta del legacy
(último / promedio / máx / mín), errores y motivo de caída, materias detectadas
hoy y pushes enviadas hoy; y **control remoto** (reiniciar / frenar / arrancar el
daemon desde la web) vía un supervisor local que lo mantiene vivo y arranca solo
al bootear la PC.

## Contexto: qué ya existe

- **Web Push completo y funcionando** (iOS + Android):
  - `public/sw.js` — maneja `push` y `notificationclick` (abre `data.url`).
  - Tabla `web_push_subscriptions` (`user_key`, `endpoint`, `p256dh`, `auth`,
    `active`, …). `user_key` = email (o username) del usuario de Campus.
  - `lib/webPush.ts`:
    - `sendPushNotification(payload, excludeUserKeys?)` — broadcast a todas las
      suscripciones activas; limpia las caducadas (404/410).
    - `sendPushToUser(userKey, payload)` — sólo a las suscripciones de ese user.
- **Preferencias de usuario**:
  - `perfil_notificaciones` (`email` único, `notificaciones_globales_activas`,
    `notificar_asistencia`, `notificar_chat`, …). Se auto-crea en `/notificaciones`
    con `notificar_asistencia: true`.
  - `/notificaciones` tiene el toggle "Avisar asistencia disponible".
- **`agent.js`** (raíz del repo) — poller que:
  1. loguea al legacy con `ASISTENCIA_USER` / `ASISTENCIA_PASSWORD` (env),
  2. `GET /apply-leave.php` cada `ASISTENCIA_POLL_MS` (default 120000),
  3. parsea `select[name="id_materia"] option` y toma las que tienen
     `data-habilitada="S"` y no están `disabled`,
  4. si hay alguna abierta, `POST /api/webhooks/asistencia` con
     `{ source, materia, activeOptions: [{id, name}] }` y cabecera
     `x-agent-secret: NOTIFICATIONS_WEBHOOK_SECRET`,
  5. hace heartbeat a `/api/asistencia/agent` (tabla `asistencia_agent_status`,
     `agent_id = "motorola-local"`), consumido por la card de estado en
     `/admin/testnotis`.
  - **Anti-repetición hoy:** variable en memoria `stoppedUntil = todayKey()`.
    Si se reinicia el proceso, vuelve a avisar. Si corren dos PCs, avisan las dos.
- **`/api/webhooks/asistencia`** (ya existe) — valida el secreto, actualiza
  `asistencia_agent_status`, arma `excludeUserKeys` con los emails de
  `perfil_notificaciones` que tienen `notificaciones_globales_activas = false` o
  `notificar_asistencia = false`, y llama
  `sendPushNotification({ title, body con materia, url: "/asistencia",
  tag: "asistencia-abierta" }, excludeUserKeys)`.
  - Limitación: sólo usa `activeOptions[0]` → si hay 2 materias abiertas a la
    vez, avisa de una sola.
- **`/api/notifications/test`** — botones en `/admin/testnotis` que mandan push
  de prueba **sólo a las suscripciones del propio admin**.
- **Admin**: `/admin/dashboard` (stats de login y errores). Cookie de sesión
  `admin_session_token`; helper `isAdminRequest(req)` en `lib/adminAuth.ts`.
- **Convenciones de scripts locales**: `scripts/proxy-casero/` y
  `scripts/captcha-remoto/` — cada uno con `start.ps1`, `README.md`, `.env` o
  `credentials.txt` gitignoreado, binarios en `bin/` gitignoreado.

## Decisiones tomadas (brainstorming)

1. **Targeting = broadcast + nombre de materia.** Se avisa a todos los que tienen
   `notificar_asistencia` activo; el texto incluye el nombre de la materia que el
   legacy reporta habilitada. **No** se filtra por materia por usuario: la app no
   guarda credenciales de Sysacad/legacy por alumno, así que no se puede
   consultar el legacy "por cada usuario". La cuenta-bot compartida sólo ve las
   materias en las que ella está inscripta, y el legacy ya resuelve "qué materia
   está habilitada ahora".
2. **Hosting = daemon local**, no cron en la nube. Motivos: frecuencia de poll
   (~2 min; Vercel Cron Hobby = 1/día, GitHub Actions = 5 min + retrasos) y la IP
   (el legacy tiene chequeo de red de facultad; una IP residencial/de facultad es
   menos probable que sea bloqueada que una de datacenter). El daemon se deja
   **sin estado local** para poder clonarlo/moverlo y, si en el futuro se quiere,
   cambiarlo por un cron sin reescribir la lógica.
3. **Usuarios nuevos = sin lógica dedicada.** El broadcast ya alcanza a cualquier
   suscripción activa; `/notificaciones` ya auto-crea el perfil con asistencia
   activada. Sólo se documenta.
4. **Monitor = calcado del captcha worker (`main`), tabla propia.** Se copia
   1:1 el patrón ya mergeado (`scripts/captcha-workers*.sql`,
   `app/api/captcha/heartbeat`, `app/api/captcha/comando`,
   `app/api/admin/captcha-workers`, `app/api/admin/captcha-command`,
   `CaptchaWorkersSection.tsx`, `lib/captchaMetricas.ts`,
   `scripts/captcha-remoto/supervisor.mts` + `install-tarea.ps1` +
   `captcha-worker.service`), con nombres `asistencia*` y las métricas propias
   del daemon (poll y tiempo de respuesta al legacy, **no** conexiones
   simultáneas — el daemon pollea, no acepta conexiones).
5. **Comandos = columnas en la misma fila** (`comando`, `comando_nonce`,
   `comando_pedido`, `comando_ack`, `comando_por`), igual que `captcha_workers`.
   No hay tabla de cola aparte.
6. **Supervisor = mirror por-script** (decidido 2026-09-03). El daemon lleva su
   propio `supervisor.mts` + su propia tarea de Windows `CampusAsistenciaWorker`,
   calcado del de captcha pero **sin túnel** (el daemon llama de salida, no
   necesita entrada). Un supervisor único que gobierne captcha + asistencia y una
   tabla `local_workers` genérica quedan como refactor posterior — no se hace
   ahora para no tocar el supervisor de captcha que ya anda.
7. **Secreto = se reusa `NOTIFICATIONS_WEBHOOK_SECRET`** para los endpoints
   nuevos del worker (`heartbeat` + `comando`), con header `x-worker-secret`.
   Diverge de captcha (que usó `CAPTCHA_HEARTBEAT_SECRET` dedicado porque su
   token de worker es `NEXT_PUBLIC_`); acá el daemon ya tiene ese secreto para
   llamar a `/api/webhooks/asistencia` y es el mismo límite de confianza ("la PC
   que corre el daemon"), así que una env var menos.

## Referencia: el patrón del captcha worker en `main`

Commits `7f08bbe`, `5381531`, `50687fe`. Piezas a espejar:

| Captcha (existe) | Asistencia (a crear) |
|---|---|
| `scripts/captcha-workers.sql` (+ `-comando.sql`, `-ram.sql`) | `scripts/asistencia-workers.sql` (todo junto) |
| `POST /api/captcha/heartbeat` (`x-worker-secret`) | `POST /api/asistencia/worker/heartbeat` |
| `GET\|POST /api/captcha/comando` | `GET\|POST /api/asistencia/worker/comando` |
| `GET /api/admin/captcha-workers` | `GET /api/admin/asistencia-workers` |
| `POST /api/admin/captcha-command` | `POST /api/admin/asistencia-command` |
| `app/admin/dashboard/_components/CaptchaWorkersSection.tsx` | `AsistenciaWorkersSection.tsx` |
| `lib/captchaMetricas.ts` (singleton, `ramHost()`, ventana RT 50) | `scripts/asistencia-daemon/metricas.mts` (al lado del daemon) |
| `scripts/captcha-remoto/supervisor.mts` (túnel + worker + comandos) | `scripts/asistencia-daemon/supervisor.mts` (solo daemon + comandos) |
| `scripts/captcha-remoto/{start.ps1, install-tarea.ps1, captcha-worker.service}` | equivalentes en `scripts/asistencia-daemon/` |

Convenciones heredadas: TS nativo de Node (`.mts` corrido con `node`, exige Node
22.6+); `start.ps1` con params que setean `$env:` y persisten config/secretos en
`*.txt` gitignoreados (`app-url.txt`, etc.); `version` = `git rev-parse --short
HEAD`; `estado` `'activo' | 'apagado'`; `conectada` = `estado === 'activo' &&
(now - actualizado) < 30_000`; `comando_vencido` = pedido sin ack hace > 90s;
`matarArbol` con `taskkill /pid X /T /F` en Windows; sección del dashboard con
`useEffect` + `setInterval(5000)` (no SWR).

## Diseño

### Componente 1 — `scripts/asistencia-daemon/`

Reemplaza a `agent.js` (que se borra). Estructura espejo de `proxy-casero`:

```
scripts/asistencia-daemon/
  daemon.mjs        lógica de login + poll + aviso (sólo builtins + deps del proyecto)
  start.ps1         arranque en Windows/PowerShell
  .env.example      plantilla de configuración
  .gitignore        ignora .env
  README.md         uso, seguridad, y "mover a otra PC"
```

**`daemon.mjs`** — porta `agent.js` con estos cambios:

- Config desde `.env` (cargado con un parser mínimo propio o
  `node --env-file=.env`, ver `start.ps1`). Variables:
  | Variable | Default | Uso |
  |---|---|---|
  | `CAMPUS_APP_URL` | `https://campus-utn.vercel.app` | base para llamar a la API |
  | `NOTIFICATIONS_WEBHOOK_SECRET` | — (requerido) | cabecera `x-agent-secret` / `x-notify-secret` |
  | `ASISTENCIA_BASE_URL` | `https://asistencia.frsfco.utn.edu.ar:4443` | legacy |
  | `ASISTENCIA_USER` / `ASISTENCIA_PASSWORD` | — | cuenta-bot (o `ASISTENCIA_COOKIE` estática) |
  | `ASISTENCIA_USER_FIELD` / `ASISTENCIA_PASSWORD_FIELD` / `ASISTENCIA_LOGIN_PATH` | `username` / `password` / `/index.php` | overrides del form de login |
  | `ASISTENCIA_POLL_MS` | `120000` | intervalo de poll |
- **Sin `stoppedUntil` en memoria.** Cada poll: si `parseActiveAttendance`
  devuelve `isOpen`, manda **todas** las `activeOptions` al webhook y sigue
  polleando normal. El webhook es idempotente (Componente 2), así que repetir el
  POST no genera avisos duplicados.
- **Instrumentación → `metricas.mts` al lado** (calco de `lib/captchaMetricas.ts`,
  pero standalone en `scripts/asistencia-daemon/`, no en `lib/`). Singleton con
  ventana móvil de 50 RT y el helper `ramHost()` **copiado tal cual** del de
  captcha (lee `/proc/meminfo` `MemAvailable`, fallback `os.totalmem/freemem`).
  `snapshot()` devuelve campos planos: `proceso_desde`, `version`,
  `ram_total_mb`, `ram_usada_mb`, `polls_total`, `errores`, `login_ok`,
  `ultimo_error`, `rt_ultimo_ms` / `rt_prom_ms` / `rt_max_ms` / `rt_min_ms`
  (duración del `GET /apply-leave.php`), `materias_hoy` (CSV de nombres
  detectados hoy, se resetea al cambiar el día Argentina), `pushes_hoy` (suma de
  `result.sent` que devuelve el webhook).
- **Heartbeat cada 10s** — `setInterval(10000)` — a
  `POST {APP_URL}/api/asistencia/worker/heartbeat` con header
  `x-worker-secret: NOTIFICATIONS_WEBHOOK_SECRET` y cuerpo
  `{ id: WORKER_ID, estado: "activo", ...metricas.snapshot() }`. `WORKER_ID` =
  `process.env.ASISTENCIA_WORKER_NAME || os.hostname()` (igual que captcha).
  Reemplaza el heartbeat viejo a `/api/asistencia/agent` (endpoint y
  `asistencia_agent_status` se retiran — Componente 5).
- **En `SIGINT` / `SIGTERM`**: un último POST con
  `{ estado: "apagado", motivo: "cierre manual" }` antes de `process.exit(0)`
  (idéntico a `server.mts`).
- **Polling de comandos (Componente 6)** — `setInterval(15000)`: `GET
  {APP_URL}/api/asistencia/worker/comando?id=WORKER_ID` con `x-worker-secret`.
  Respuesta `{ cmd, nonce }` o `{ cmd: null }`. El **daemon no ejecuta comandos**
  — lo hace el `supervisor.mts` (igual que en captcha, donde `server.mts` no
  toca comandos y el supervisor sí). Este bullet se implementa en el supervisor,
  no en el daemon; se deja acá sólo para no perder el hilo.
- Limpieza cosmética del nombre de materia: recortar sufijos tipo
  ` - 2026 - <especialidad> - <plan> - <comisión>` para el texto de la push,
  conservando el nombre completo en el payload por si se necesita.
- Logs a stdout con timestamp (igual que `agent.js`).

**`start.ps1`** — calco de `scripts/captcha-remoto/start.ps1`:
- `param([string]$Name="", [string]$AppUrl="", [int]$PollMs=0, ...)`.
- Secretos/config persistidos en `*.txt` gitignoreados: `app-url.txt`
  (reusa si existe), `credenciales.txt` (dos líneas: usuario y password de la
  cuenta-bot; si falta, avisa y corta). `NOTIFICATIONS_WEBHOOK_SECRET` **no** se
  genera acá — lo pega el usuario en un `secret.txt` (o lo toma de un prompt),
  porque tiene que ser el mismo que está en Vercel.
- `version` = `git rev-parse --short HEAD`.
- Chequea Node ≥ 22.6 (`node -e "process.versions.node"`).
- Setea `$env:CAMPUS_APP_URL`, `$env:NOTIFICATIONS_WEBHOOK_SECRET`,
  `$env:ASISTENCIA_WORKER_NAME`, `$env:ASISTENCIA_WORKER_VERSION`,
  `$env:ASISTENCIA_USER`, `$env:ASISTENCIA_PASSWORD`, `$env:ASISTENCIA_POLL_MS`,
  y `& node (Join-Path $dir "supervisor.mts")` (el supervisor orquesta el
  daemon, igual que en captcha).
- Header con nota sobre `install-tarea.ps1` para arranque automático.

**`README.md`** — cubre:
- Qué hace y por qué corre local (resumen de las decisiones 1–2).
- Requisitos: Node 22.6+ en el PATH, PowerShell.
- Setup una vez: correr `scripts/asistencia-workers.sql` +
  `scripts/asistencia-avisos-log.sql` en Supabase; `NOTIFICATIONS_WEBHOOK_SECRET`
  ya está en Vercel (se reusa).
- Uso: `.\start.ps1 -AppUrl https://campusutn.dpdns.org -Name esta-pc`, completar
  `credenciales.txt`, dejar la ventana abierta.
- "Mover a otra PC": clonar el repo, copiar los `*.txt`, `.\start.ps1`. Se puede
  tener las dos PCs prendidas: el dedup en BD evita avisos dobles (y el monitor
  muestra las dos como workers separados).
- "Usuarios nuevos": no hay que hacer nada; el aviso alcanza a toda suscripción
  activa.
- Auto-arranque: `.\install-tarea.ps1 -Args "-AppUrl … -Name …"`.
- Seguridad: `credenciales.txt` / `app-url.txt` / `secret.txt` gitignoreados.

### Componente 2 — dedup en Supabase + `/api/webhooks/asistencia`

**Tabla nueva** (`scripts/asistencia-avisos-log.sql`, y agregada también al
consolidado `scripts/notifications.sql`):

```sql
CREATE TABLE IF NOT EXISTS asistencia_avisos_log (
  fecha           DATE NOT NULL,
  materia_id      TEXT NOT NULL,
  materia_nombre  TEXT,
  enviado_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  enviados        INT DEFAULT 0,
  PRIMARY KEY (fecha, materia_id)
);
```

**`app/api/webhooks/asistencia/route.ts`** pasa a:

1. Validar secreto (igual que hoy: `x-agent-secret` o `x-notify-secret`).
2. Leer `activeOptions: {id, name}[]` del body (si viene el viejo
   `{ materia }` suelto, envolverlo como `[{ id: materia, name: materia }]` para
   compatibilidad).
3. Calcular `excludeUserKeys` una sola vez (igual que hoy). Se quita la llamada
   a `updateAgentStatus` — `asistencia_agent_status` se retira (Componente 5); el
   estado del daemon lo lleva ahora el heartbeat.
4. **Por cada** materia de `activeOptions`:
   - `fecha` = hoy en `America/Argentina/Buenos_Aires` (`YYYY-MM-DD`).
   - `INSERT` en `asistencia_avisos_log` con `Prefer: return=representation` y
     manejo de conflicto: usar `on_conflict=fecha,materia_id` **sin**
     `merge-duplicates` → si la fila ya existía, PostgREST devuelve la existente
     sin tocarla; distinguimos "insertada ahora" de "ya estaba" comparando
     `enviado_at`/`enviados` o, más robusto, haciendo primero un `GET` de la
     clave y `POST` sólo si no hay fila. Elegido: **GET + POST condicional**
     (simple y legible; la carrera entre dos daemons es tolerable — en el peor
     caso el `POST` duplicado lo frena la PK y se captura el error 409).
   - Si ya se avisó hoy de esa materia → continuar sin enviar.
   - Si no → `sendPushNotification({ title: "¡La asistencia está abierta!",
     body: \`Ya podés marcar asistencia en ${nombreLimpio}.\`,
     url: "/asistencia", tag: \`asistencia-${materiaId}\` }, excludeUserKeys)` y
     luego `PATCH` de la fila con `enviados = result.sent`.
5. Responder `{ ok: true, materias: [{ materiaId, skipped|sent, ... }] }`.

`/api/asistencia/notify` (disparo manual de admin) se deja como está — es
broadcast puntual sin dedup, pensado justamente para forzar el envío.

### Componente 3 — pruebas desde `/admin/dashboard`

**Endpoint nuevo** `app/api/admin/notifications/test-send/route.ts`:

- `export const runtime = "nodejs"`.
- `if (!isAdminRequest(req)) → 401`.
- Body: `{ target: "all" | "email", email?: string }`.
  - `target === "email"`: requiere `email`; `sendPushToUser(email.trim(), payload)`.
  - `target === "all"`: `sendPushNotification(payload)` (sin exclusiones — es una
    prueba y el admin quiere ver que llega).
- `payload` de prueba:
  ```ts
  {
    title: "🔔 Prueba — Campus UTN",
    body: "Notificación de prueba. Si la ves, las push están funcionando.",
    url: "/asistencia",
    tag: `test-${Date.now()}`,   // único → siempre aparece
    icon: "/logo.png",
  }
  ```
- Respuesta: el `SendPushResult` (`total`, `sent`, `failed`, `errors?`). Si
  `target === "email"` y `total === 0` → 404 con mensaje
  "Ese usuario no tiene suscripciones push activas".

**UI** en `app/admin/dashboard/_components/AdminDashboardClient.tsx`:

- Sección nueva "Notificaciones push (prueba)" (mismo lenguaje visual iOS que el
  resto: tarjetas `rounded-[20px]`, `var(--surface)`, etc.).
- Un `<input type="email">` + botón **"Enviar a este usuario"**.
- Botón **"Enviar a todos"** (con un `confirm()` porque llega a todos los
  dispositivos reales).
- Estado por botón (`idle | loading | success | error`) y bloque de resultado
  (`total` / `enviadas OK` / `fallidas` / errores), reutilizando el patrón de
  `AdminPanelClient` (`LastResult`).
- Ambos llaman a `POST /api/admin/notifications/test-send`.

### Componente 4 — usuarios nuevos

Sin cambios de código. Se documenta en el `README.md` del daemon y se deja una
nota en este spec: el broadcast de `/api/webhooks/asistencia` alcanza a toda
suscripción `active = true` no excluida; `/notificaciones` ya siembra el perfil
con `notificar_asistencia: true` la primera vez que el usuario entra. No hace
falta "vigilar" altas.

### Componente 5 — monitor en `/admin/dashboard`

Calco de `captcha_workers` + sus endpoints + `CaptchaWorkersSection.tsx`. Sólo
cambian los nombres (`asistencia*`) y las métricas (poll, no conexiones).

**Tabla** `scripts/asistencia-workers.sql` — misma forma que
`scripts/captcha-workers.sql` (RLS on, índice `actualizado desc`), con las
columnas de comando ya incluidas (no en un ALTER aparte, porque acá se hace
todo junto):

```sql
create table if not exists public.asistencia_workers (
  id             text primary key,          -- nombre del worker (-Name, default hostname)
  actualizado    timestamptz not null default now(),
  proceso_desde  timestamptz,
  version        text,
  estado         text not null default 'activo',  -- 'activo' | 'apagado'
  motivo         text,
  ram_total_mb   integer not null default 0,
  ram_usada_mb   integer not null default 0,
  -- métricas propias del daemon:
  polls_total    integer not null default 0,
  errores        integer not null default 0,
  login_ok       boolean not null default false,
  ultimo_error   text,
  rt_ultimo_ms   integer not null default 0,
  rt_prom_ms     integer not null default 0,
  rt_max_ms      integer not null default 0,
  rt_min_ms      integer not null default 0,
  materias_hoy   text,                       -- CSV de nombres detectados hoy
  pushes_hoy     integer not null default 0,
  -- comandos (mismas columnas que captcha_workers):
  comando        text,                       -- 'reiniciar' | 'frenar' | 'arrancar' | null
  comando_nonce  text,
  comando_pedido timestamptz,
  comando_ack    timestamptz,
  comando_por    text
);
create index if not exists asistencia_workers_actualizado_idx
  on public.asistencia_workers (actualizado desc);
alter table public.asistencia_workers enable row level security;
```

**`POST /api/asistencia/worker/heartbeat`** — calco de
`app/api/captcha/heartbeat/route.ts`: `runtime = "nodejs"`,
`dynamic = "force-dynamic"`, header `x-worker-secret === NOTIFICATIONS_WEBHOOK_SECRET`,
helper `n()` para coerción numérica, `upsert` a
`asistencia_workers?on_conflict=id` con
`Prefer: resolution=merge-duplicates,return=minimal`, `actualizado = now()`,
`estado` = `"apagado"` sólo si el body lo dice, si no `"activo"`.

**`GET|POST /api/asistencia/worker/comando`** — calco **exacto** de
`app/api/captcha/comando/route.ts`: `GET ?id=X` con `x-worker-secret` devuelve
`{ cmd, nonce }` si `comando && !comando_ack`, si no `{ cmd: null }`;
`POST { id, nonce }` marca `comando_ack = now()`.

**`GET /api/admin/asistencia-workers`** — calco de
`app/api/admin/captcha-workers/route.ts`: `isAdminRequest`, lee
`asistencia_workers?select=*&order=actualizado.desc`, devuelve
`{ workers, ahora }` donde cada worker suma `hace_ms`, `activa_hace_ms`,
`conectada = estado === "activo" && hace_ms < 30_000`,
`comando_vencido = comando && !comando_ack && (now - comando_pedido) > 90_000`.

**`POST /api/admin/asistencia-command`** — calco de
`app/api/admin/captcha-command/route.ts`: `isAdminRequest`, body `{ id, cmd }`
con `cmd ∈ {reiniciar, frenar, arrancar}`, genera `nonce`, `PATCH` de la fila
con `comando/comando_nonce/comando_pedido/comando_ack:null/comando_por:"admin"`.

**Sección** `app/admin/dashboard/_components/AsistenciaWorkersSection.tsx` —
calco de `CaptchaWorkersSection.tsx`:

- `useEffect` + `setInterval(cargar, 5000)` sobre `/api/admin/asistencia-workers`
  (no SWR), `enviando` state para los botones.
- Título de sección: "Daemon de asistencia — workers".
- Tarjeta por worker: punto verde/rojo, `id`, "conectada"/"desconectada".
- Grid `grid-cols-3 md:grid-cols-4` de `Dato`: "Activa hace"
  (`dur(activa_hace_ms)`), "Última señal" (`hace ${dur(hace_ms)}`), `RamDato`
  (barra, mismo componente), "Polls" (`polls_total`), "Errores" (`errores`),
  "Login legacy" (`login_ok ? "OK" : "fallando"`), "RT último" (`ms()`),
  "RT promedio", "RT mín / máx", "Materias hoy" (`materias_hoy` como chips o
  texto), "Pushes hoy" (`pushes_hoy`).
- Banner de caída: `estado === "apagado" && motivo` → `Apagada: ${motivo}`;
  si no → `Sin señal desde ${new Date(actualizado).toLocaleTimeString("es-AR")}
  — PC apagada, sin internet, o el script se cerró.`
- Botones **Reiniciar** / **Frenar** / **Arrancar** → `POST
  /api/admin/asistencia-command` con `{ id, cmd }`; al lado, estado del comando:
  `comando_ack ? "confirmado ✓" : comando_vencido ? "sin respuesta" : "pendiente…"`.
- Montada en `AdminDashboardClient` **justo después de `<CaptchaWorkersSection/>`**.

**Retiro de lo viejo**: se elimina `asistencia_agent_status`,
`app/api/asistencia/agent/route.ts` y el componente `AgentStatus` de
`AdminPanelClient` (`/admin/testnotis`); `/api/asistencia/notify` deja de tocar
`asistencia_agent_status`; y en `AdminDashboardClient` la entrada `TOOLS`
"Simulador PWA" pierde el "y ver el agente de asistencia" de su `description`.

### Componente 6 — supervisor + auto-arranque

Los comandos ya viven como columnas en `asistencia_workers` (Componente 5) y los
endpoints `GET|POST /api/asistencia/worker/comando` ya están descritos ahí. Acá
sólo el lado PC.

**`scripts/asistencia-daemon/supervisor.mts`** — calco de
`scripts/captcha-remoto/supervisor.mts` **sin la parte del túnel**:

- Un proceso Node siempre corriendo. Env que le pasa `start.ps1`:
  `CAMPUS_APP_URL`, `NOTIFICATIONS_WEBHOOK_SECRET`, `ASISTENCIA_WORKER_NAME`, y
  todo lo del daemon (`ASISTENCIA_USER/PASSWORD/POLL_MS`, `ASISTENCIA_WORKER_VERSION`).
- Lanza `node daemon.mts` (un solo hijo, no hay túnel). `abrirWorker()` con
  `stdio: "inherit"` y `env` propagado.
- **Keep-alive**: en `exit` del hijo, si no está `apagando` ni `frenado`, lo
  relanza con backoff `2s → x2 → tope 30s` (mismo esquema que captcha).
- **`matarArbol()`** copiado tal cual: `taskkill /pid X /T /F` en Windows,
  `SIGTERM` + `SIGKILL` a los 3s en Linux.
- **`pollComandos()`** cada 15s: `GET {APP_URL}/api/asistencia/worker/comando?id=WORKER_ID`
  con `x-worker-secret`; `frenar` → mata el hijo y `frenado = true`; `arrancar`
  y `reiniciar` → `frenado = false` + `reiniciarCiclo()`; luego `POST` de ACK
  con `{ id, nonce }`.
- `SIGINT`/`SIGTERM` → `matarArbol(worker)` + `process.exit(0)`.

**`scripts/asistencia-daemon/install-tarea.ps1`** — calco de
`scripts/captcha-remoto/install-tarea.ps1`: registra la tarea
`CampusAsistenciaWorker` (`-AtLogOn`, `RestartCount 999`,
`ExecutionTimeLimit 0`, `MultipleInstances IgnoreNew`) que corre
`start.ps1` con los `-Args` que se le pasen.

**`scripts/asistencia-daemon/asistencia-worker.service`** — unidad systemd
equivalente para una PC Linux (`ExecStart=/usr/bin/node
scripts/asistencia-daemon/supervisor.mts`, `Restart=always`).

**"Levantarlo desde la web" — por qué así y no SSH** (sin cambios): se descartó
SSH (abre el puerto 22, clave privada en Vercel, funciones efímeras) y
Wake-on-LAN (sólo prende la PC, no arranca el script). El patrón heartbeat +
columna de comando no abre ningún puerto entrante: todo es la PC llamando de
salida. Único caso no cubierto: PC físicamente apagada (WoL, o dejarla siempre
encendida — que es el plan).

**Refactor futuro (no ahora)**: un único `scripts/supervisor/` que gobierne
captcha + asistencia como hijos, y una tabla `local_workers` genérica que
reemplace `captcha_workers` + `asistencia_workers`. Se difiere para no tocar el
supervisor de captcha ya funcionando.

## Variables de entorno

**Ya en Vercel (no cambian):** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (opcional), `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NOTIFICATIONS_WEBHOOK_SECRET`, `SESSION_SECRET`.
No hace falta ninguna env var nueva en Vercel — los endpoints del worker de
asistencia validan contra `NOTIFICATIONS_WEBHOOK_SECRET` (decisión 7).

**En la PC (las setea `start.ps1` desde params + `*.txt` gitignoreados, estilo
`captcha-remoto/start.ps1` — no hay `.env`):**
`CAMPUS_APP_URL` (de `app-url.txt` / `-AppUrl`), `NOTIFICATIONS_WEBHOOK_SECRET`
(de `secret.txt`, mismo valor que Vercel), `ASISTENCIA_USER` +
`ASISTENCIA_PASSWORD` (de `credenciales.txt`), `ASISTENCIA_WORKER_NAME`
(de `-Name`, default hostname), `ASISTENCIA_WORKER_VERSION` (git short sha),
`ASISTENCIA_POLL_MS` (de `-PollMs`, default 120000), overrides opcionales del
form de login. El `supervisor.mts` recibe todas por `process.env` y las propaga
al `daemon.mts` hijo.

## Archivos

| Acción | Archivo | Motivo |
|---|---|---|
| nuevo | `scripts/asistencia-daemon/daemon.mts` | porta `agent.js`, sin estado local, loop por materia, instrumentación, heartbeat |
| nuevo | `scripts/asistencia-daemon/metricas.mts` | calco de `lib/captchaMetricas.ts` (singleton, `ramHost()`, ventana RT 50, `snapshot()`) |
| nuevo | `scripts/asistencia-daemon/supervisor.mts` | calco de `captcha-remoto/supervisor.mts` sin túnel: keep-alive + `pollComandos()` + ACK |
| nuevo | `scripts/asistencia-daemon/start.ps1` | calco de `captcha-remoto/start.ps1`: params, `*.txt`, `$env:`, lanza `supervisor.mts` |
| nuevo | `scripts/asistencia-daemon/install-tarea.ps1` | calco: tarea `CampusAsistenciaWorker` (Task Scheduler) |
| nuevo | `scripts/asistencia-daemon/asistencia-worker.service` | calco: unidad systemd para PC Linux |
| nuevo | `scripts/asistencia-daemon/README.md` | uso + mover a otra PC + auto-arranque + usuarios nuevos |
| borrar | `agent.js` | reemplazado por `daemon.mts` |
| editar | `.gitignore` | agrega `scripts/asistencia-daemon/{app-url.txt,secret.txt,credenciales.txt}` |
| nuevo | `scripts/asistencia-workers.sql` | `asistencia_workers` (con columnas de comando), estilo `captcha-workers.sql` |
| nuevo | `scripts/asistencia-avisos-log.sql` | tabla de dedup `asistencia_avisos_log` |
| editar | `scripts/notifications.sql` | agregar las dos tablas al consolidado |
| editar | `app/api/webhooks/asistencia/route.ts` | loop por materia + dedup en BD + tag por materia; deja de tocar `asistencia_agent_status` |
| nuevo | `app/api/admin/notifications/test-send/route.ts` | envío de prueba (email / todos) |
| nuevo | `app/api/asistencia/worker/heartbeat/route.ts` | calco de `api/captcha/heartbeat` |
| nuevo | `app/api/asistencia/worker/comando/route.ts` | calco de `api/captcha/comando` (GET toma / POST ACK) |
| nuevo | `app/api/admin/asistencia-workers/route.ts` | calco de `api/admin/captcha-workers` |
| nuevo | `app/api/admin/asistencia-command/route.ts` | calco de `api/admin/captcha-command` (encola comando) |
| borrar | `app/api/asistencia/agent/route.ts` | reemplazado por `worker/heartbeat` |
| nuevo | `app/admin/dashboard/_components/AsistenciaWorkersSection.tsx` | calco de `CaptchaWorkersSection.tsx` |
| editar | `app/admin/dashboard/_components/AdminDashboardClient.tsx` | monta sección de prueba + `<AsistenciaWorkersSection/>` tras `<CaptchaWorkersSection/>`; ajusta `description` de "Simulador PWA" |
| editar | `app/admin/_components/AdminPanelClient.tsx` | quita el componente `AgentStatus` (tabla retirada) |

## Notas para la implementación

- **AGENTS.md**: esta versión de Next (16.2.6) tiene breaking changes — leer la
  guía pertinente en `node_modules/next/dist/docs/` antes de escribir route
  handlers.
- Los archivos marcados "calco de X" se implementan copiando X y renombrando;
  no reinventar la forma. Divergencias intencionales: secreto reusado
  (decisión 7), sin túnel en el supervisor, métricas de poll en vez de
  conexiones.

## Testing

No hay suite automatizada. Verificación manual:

1. `npm run typecheck` y `npm run lint` sin errores nuevos.
2. **Webhook + dedup**: con `next dev` corriendo, dos `curl` iguales a
   `POST /api/webhooks/asistencia` con `x-agent-secret` y body
   `{ "activeOptions": [{ "id": "TEST1", "name": "MATERIA DE PRUEBA - 2026 - X" }] }`.
   El primero responde `sent > 0`; el segundo, `skipped` para esa materia.
   Verificar la fila en `asistencia_avisos_log`.
3. **Dos materias**: un `curl` con `activeOptions` de dos items → dos filas, dos
   envíos (una push por materia).
4. **Daemon**: completar `.env` apuntando `CAMPUS_APP_URL` a `next dev` y
   `ASISTENCIA_*` a la cuenta-bot real; `.\start.ps1`; confirmar en logs el poll
   y, cuando haya asistencia real abierta (o forzando con la cuenta-bot), el POST
   al webhook.
5. **Monitor**: con `start.ps1` corriendo, `/admin/dashboard` muestra la tarjeta
   del worker "conectada", "Activa hace N m", RAM, y RT/contadores que suben poll
   a poll. Ctrl+C en la ventana → `estado="apagado"`, banner "Apagada: cierre
   manual". Matar el proceso a la fuerza → a los ~30s "desconectada" + "Sin señal
   desde HH:MM".
6. **Comandos**: desde el monitor, "Reiniciar" → `POST /api/admin/asistencia-command`
   setea `comando`/`comando_nonce`/`comando_pedido`; el `supervisor.mts` lo toma
   en ≤15s, mata y relanza el daemon, y hace `POST` de ACK → la etiqueta pasa a
   "confirmado ✓". "Frenar" → el supervisor no relanza. "Arrancar" → vuelve. Si
   pasan 90s sin ACK → "sin respuesta".
7. **Supervisor / auto-arranque**: matar `daemon.mts` desde el Task Manager → el
   supervisor lo relanza con backoff (ver logs `[sup]`). `.\install-tarea.ps1
   -Args "-AppUrl … -Name …"`, reiniciar la PC → la tarea `CampusAsistenciaWorker`
   levanta `start.ps1` → supervisor + daemon solos.
8. **Admin (prueba)**: en `/admin/dashboard`, "Enviar a este usuario" con el
   propio email → llega a este dispositivo; con un email sin suscripciones → 404
   con mensaje. "Enviar a todos" → llega el resultado con `total`/`sent`.
9. **PWA iOS + Android**: instalar la app en un iPhone y un Android, activar
   notificaciones, disparar "Enviar a todos" y un aviso de asistencia real →
   ambas llegan y al tocarlas abren `/asistencia`.

## Fuera de alcance

- Filtrado del aviso por materia por usuario (requiere credenciales de legacy por
  alumno — no disponibles).
- Migrar el daemon a cron en la nube (el diseño lo deja posible; no se hace ahora).
- Notificaciones por Telegram para asistencia (el canal Telegram existente es
  para tareas; no se toca).
- Cambios en `public/sw.js` (el handler actual ya cubre este payload).
- Wake-on-LAN / encender la PC apagada de forma remota (se asume PC siempre
  encendida).
- Acceso por SSH desde la web (descartado por superficie de ataque — ver
  Componente 6).
- Unificar la tabla de workers con `captcha_workers` de la conversación paralela
  (se decidió tabla propia; una futura `local_workers` genérica queda como
  posible refactor posterior).
