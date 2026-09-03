# Notificaciones de asistencia — daemon local + pruebas desde admin

Fecha: 2026-09-02
Estado: aprobado (diseño) — **implementación bloqueada** hasta que cierre la
conversación paralela del monitor del captcha worker (ver "Dependencia y orden
de trabajo").

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
hoy y pushes enviadas hoy; y **control remoto** (reiniciar / parar / arrancar el
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
4. **Monitor = mismo patrón que el captcha worker, tabla propia.** Se copia la
   forma del monitor que está diseñando la conversación paralela (heartbeat con
   métricas cada ~10s → tabla → endpoint admin → sección en `/admin/dashboard`),
   pero con tabla `asistencia_workers` y endpoint propios, sin compartir con
   `captcha_workers`. Las métricas de conexiones simultáneas **no aplican** (el
   daemon pollea, no acepta conexiones); las métricas reales son de poll y de
   tiempo de respuesta al legacy.
5. **Control remoto = ahora, con supervisor único.** Entra en este spec: cola de
   comandos en Supabase + botones en el monitor + un supervisor local que
   mantiene vivo al daemon, obedece los comandos y arranca al bootear. El
   supervisor se diseña para poder gobernar **también** el captcha worker + túnel
   (un solo servicio en la PC), coordinando con la conversación paralela.

## Dependencia y orden de trabajo

La conversación paralela ("monitor del captcha worker") define primero:

- el shape del heartbeat con métricas y de la tabla (`captcha_workers`);
- el endpoint admin (`/api/admin/captcha-workers`) y el componente de sección;
- el mecanismo de "levantarlo desde la web": supervisor + cola de comandos
  (`/api/captcha/comando`) + auto-arranque (nssm / Task Scheduler).

**No se arranca la implementación de este spec hasta que eso esté mergeado.**
Cuando lo esté, este diseño se ajusta para **espejar los nombres y la estructura
finales** (columnas, endpoints, forma de la cola de comandos, forma del
supervisor) en vez de lo aquí propuesto, que es la mejor estimación a hoy. Los
Componentes 1–4 no dependen de esa conversación y podrían adelantarse, pero se
prefiere un solo tramo de trabajo ordenado.

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
- **Instrumentación (para el monitor, Componente 5).** Contadores en memoria +
  ventana móvil de los últimos 50 RT, en `lib`-style local dentro de
  `daemon.mjs` (o `metricas.mjs` al lado): `poll_count`, `errores`,
  `rt_ultimo_ms` / `rt_prom_ms` / `rt_max_ms` / `rt_min_ms` (duración del
  `GET /apply-leave.php`), `login_ok`, `ultimo_error` + `ultimo_error_at`,
  `materias_detectadas_hoy` (set de nombres, se resetea al cambiar el día
  Argentina), `pushes_enviadas_hoy` (suma de `result.sent` que devuelve el
  webhook).
- **Heartbeat cada ~10s** a `POST /api/asistencia/worker/heartbeat` (secret-
  gated) con: `worker_id` (`"asistencia-daemon"`, override
  `ASISTENCIA_WORKER_ID`), `estado` (`running`), `proceso_desde`, `version`
  (constante en el archivo), `host` (`os.hostname()`), y el bloque de métricas de
  arriba. Sustituye al heartbeat viejo a `/api/asistencia/agent` (ese endpoint y
  `asistencia_agent_status` se retiran — ver Componente 5).
- **En `SIGINT` / `SIGTERM`**: un último heartbeat con `estado: "stopped"` y
  `motivo: "cierre limpio (señal X)"` antes de salir.
- **Polling de comandos (Componente 6).** Cada ~15s, `GET
  /api/asistencia/worker/comando?worker_id=…` (secret-gated). Si hay un comando
  `stop` → heartbeat `stopped` + `process.exit(0)` (el supervisor decide si
  relanzar). `restart` → `process.exit(0)` con código que el supervisor
  interpreta como "volvé a levantarme". `start` es no-op para el daemon (lo
  maneja el supervisor). Tras ejecutarlo, `POST` de ack a
  `/api/asistencia/worker/comando`.
- Limpieza cosmética del nombre de materia: recortar sufijos tipo
  ` - 2026 - <especialidad> - <plan> - <comisión>` para el texto de la push,
  conservando el nombre completo en el payload por si se necesita.
- Logs a stdout con timestamp (igual que `agent.js`).

**`start.ps1`** — espejo de `proxy-casero/start.ps1` pero más simple:
- Si no existe `.env`, copia `.env.example` a `.env`, avisa "completá .env" y
  corta.
- Lanza `node --env-file=.env daemon.mjs` (Node 20+ del proyecto soporta
  `--env-file`). Deja la ventana abierta; Ctrl+C corta.
- Nota en el header sobre Task Scheduler para arranque automático.

**`README.md`** — cubre:
- Qué hace y por qué corre local (resumen de las decisiones 1–2).
- Requisitos: Node en el PATH, PowerShell.
- Uso: completar `.env`, `.\start.ps1`, dejar la ventana abierta.
- Qué env vars van en `.env` (local) vs. cuáles ya están en Vercel
  (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NOTIFICATIONS_WEBHOOK_SECRET`).
- "Mover a otra PC": clonar el repo, copiar `.env`, `npm install` (o sólo tener
  Node), `.\start.ps1`. Se puede tener las dos PCs prendidas: el dedup en BD
  evita avisos dobles.
- "Usuarios nuevos": no hay que hacer nada; el aviso alcanza a toda suscripción
  activa.
- Seguridad: el `.env` con la credencial de la cuenta-bot está gitignoreado.

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

> Nombres y forma sujetos a espejar el resultado final de la conversación
> paralela (ver "Dependencia y orden de trabajo").

**Tabla nueva** `asistencia_workers` (en `scripts/asistencia-workers.sql` y
consolidado en `scripts/notifications.sql`):

```sql
CREATE TABLE IF NOT EXISTS asistencia_workers (
  worker_id      TEXT PRIMARY KEY,           -- "asistencia-daemon"
  estado         TEXT NOT NULL DEFAULT 'stopped', -- running | stopped | error
  motivo         TEXT,                       -- por qué no está corriendo
  actualizado    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),  -- último heartbeat
  proceso_desde  TIMESTAMP WITH TIME ZONE,   -- arranque del proceso actual
  version        TEXT,
  host           TEXT,
  metrics        JSONB DEFAULT '{}'::jsonb,  -- poll_count, rt_*, errores, etc.
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Endpoint de heartbeat** `app/api/asistencia/worker/heartbeat/route.ts`:
`runtime = "nodejs"`, valida `x-agent-secret` / `x-notify-secret` contra
`NOTIFICATIONS_WEBHOOK_SECRET`, hace `upsert` (`on_conflict=worker_id`,
`merge-duplicates`) con `actualizado = now()`. Fire-and-forget para el daemon.

**Endpoint admin** `app/api/admin/asistencia-workers/route.ts`: `GET`,
`isAdminRequest`. Devuelve las filas de `asistencia_workers` con un campo
calculado `conectado = (now - actualizado) < 30_000`. Si `conectado === false`,
`motivo_desconexion`: el `motivo` guardado (si hubo cierre limpio) o
`"sin señal desde <hora de 'actualizado'>"`.

**Sección** `app/admin/dashboard/_components/AsistenciaWorkerSection.tsx`
(montada en `AdminDashboardClient`, debajo de la sección de prueba):

- `useSWR` con `refreshInterval: 5000`.
- Semáforo verde/rojo + título "Daemon de asistencia".
- Verde: "Conectado — hace 2 h 14 m" (desde `proceso_desde`), host, versión.
- Rojo: `motivo_desconexion` en tono naranja ("sin señal desde 21:03 — ¿la PC,
  internet o el script?").
- Grilla de métricas (de `metrics`): polls hechos, RT último / prom / máx / mín,
  errores, último error, login al legacy (ok / fallando), materias detectadas
  hoy (chips), pushes enviadas hoy.
- Botones **Reiniciar** / **Parar** / **Arrancar** → `POST
  /api/admin/asistencia-workers/comando` (Componente 6). Deshabilitados mientras
  hay un comando `pendiente` para ese worker; muestran el estado del último
  comando ("reiniciando…", "ejecutado 21:40", "sin respuesta del supervisor").

**Retiro de lo viejo**: se elimina `asistencia_agent_status`,
`app/api/asistencia/agent/route.ts` y el componente `AgentStatus` de
`AdminPanelClient` (`/admin/testnotis`). El estado del daemon pasa a verse sólo
en el monitor nuevo de `/admin/dashboard`. `/api/asistencia/notify` deja de
tocar `asistencia_agent_status`.

### Componente 6 — supervisor + cola de comandos + auto-arranque

**Tabla nueva** `worker_comandos` (en el mismo `.sql`):

```sql
CREATE TABLE IF NOT EXISTS worker_comandos (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id     TEXT NOT NULL,
  comando       TEXT NOT NULL,              -- restart | stop | start
  estado        TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | ejecutado | error
  creado_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ejecutado_at  TIMESTAMP WITH TIME ZONE,
  resultado     TEXT
);
CREATE INDEX IF NOT EXISTS worker_comandos_pend_idx
  ON worker_comandos (worker_id, estado) WHERE estado = 'pendiente';
```

**Endpoints**:

- `POST /api/admin/asistencia-workers/comando` — `isAdminRequest`. Body
  `{ worker_id, comando }`. Inserta fila `pendiente`. Rechaza si ya hay una
  `pendiente` para ese `worker_id` (evita cola infinita).
- `GET /api/asistencia/worker/comando?worker_id=…` — secret-gated. Devuelve el
  comando `pendiente` más viejo (o `null`).
- `POST /api/asistencia/worker/comando` — secret-gated. Body
  `{ id, estado: "ejecutado" | "error", resultado? }`. Marca la fila.

**Supervisor** `scripts/supervisor/supervisor.mjs` + `start.ps1` + `README.md`:

- Un proceso Node siempre corriendo. Config por `.env` propio (reusa el mismo
  `NOTIFICATIONS_WEBHOOK_SECRET` y `CAMPUS_APP_URL`).
- Lanza y vigila **hijos** definidos en un array: por ahora el daemon de
  asistencia (`node --env-file=… daemon.mjs`). Pensado para agregar el captcha
  worker + túnel `bore` como hijos adicionales, coordinando con la conversación
  paralela — si esa conversación entrega su propio supervisor, este se funde con
  aquel en vez de duplicarlo.
- **Keep-alive**: si un hijo sale, lo relanza con backoff (1s, 2s, 5s, 15s, tope
  30s). Si sale con el "código de restart" pedido por comando, lo relanza ya.
- **Comandos**: cada ~15s hace `GET .../worker/comando` por cada hijo. `stop` →
  mata el hijo y no lo relanza hasta un `start`. `restart` → lo mata (se
  relanza solo). `start` → si estaba detenido, lo lanza. Ack con `POST`.
- Heartbeat propio opcional (`worker_id: "supervisor"`) para ver en el monitor
  que el supervisor mismo está vivo.
- **Auto-arranque**: el `README.md` documenta instalarlo como servicio con
  **nssm** (`nssm install CampusUTNSupervisor …`) o, más simple, una tarea de
  **Task Scheduler** "al iniciar sesión" que corre `start.ps1`. Al prender la
  PC, el supervisor levanta todo solo.

**"Levantarlo desde la web" — por qué así y no SSH**: se descartó exponer SSH
(abre el puerto 22 a internet, clave privada en Vercel, funciones efímeras) y
Wake-on-LAN (sólo prende la PC, no arranca el script, y necesita reenvío en el
router). El patrón supervisor + cola de comandos no abre ningún puerto entrante
en la PC: todo es la PC llamando de salida a la API. Único caso no cubierto: PC
físicamente apagada (ahí haría falta WoL, o dejarla siempre encendida — que es
el plan).

## Variables de entorno

**Ya en Vercel (no cambian):** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (opcional), `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NOTIFICATIONS_WEBHOOK_SECRET`, `SESSION_SECRET`.

**Nuevas, sólo en `scripts/asistencia-daemon/.env` (local, gitignoreado):**
`CAMPUS_APP_URL`, `NOTIFICATIONS_WEBHOOK_SECRET` (copia del de Vercel),
`ASISTENCIA_USER`, `ASISTENCIA_PASSWORD` (o `ASISTENCIA_COOKIE`),
`ASISTENCIA_POLL_MS` (opcional), `ASISTENCIA_WORKER_ID` (opcional, default
`asistencia-daemon`), overrides opcionales del form de login.

**En `scripts/supervisor/.env` (local, gitignoreado):** `CAMPUS_APP_URL`,
`NOTIFICATIONS_WEBHOOK_SECRET`. El supervisor no necesita las credenciales del
legacy — se las pasa el `.env` del daemon hijo.

## Archivos

| Acción | Archivo | Motivo |
|---|---|---|
| nuevo | `scripts/asistencia-daemon/daemon.mjs` | porta `agent.js`, sin estado local, loop por materia, instrumentación, heartbeat con métricas, polling de comandos |
| nuevo | `scripts/asistencia-daemon/metricas.mjs` | contadores + ventana móvil de RT (si no queda inline en `daemon.mjs`) |
| nuevo | `scripts/asistencia-daemon/start.ps1` | arranque |
| nuevo | `scripts/asistencia-daemon/.env.example` | plantilla config |
| nuevo | `scripts/asistencia-daemon/.gitignore` | ignora `.env` |
| nuevo | `scripts/asistencia-daemon/README.md` | uso + mover a otra PC + usuarios nuevos |
| borrar | `agent.js` | reemplazado por el daemon |
| nuevo | `scripts/supervisor/supervisor.mjs` | keep-alive de hijos + ejecución de comandos + auto-arranque |
| nuevo | `scripts/supervisor/start.ps1` | arranque del supervisor |
| nuevo | `scripts/supervisor/.env.example` + `.gitignore` | config del supervisor |
| nuevo | `scripts/supervisor/README.md` | instalar como servicio (nssm / Task Scheduler) |
| nuevo | `scripts/asistencia-avisos-log.sql` | tabla de dedup + `asistencia_workers` + `worker_comandos` (o `.sql` por tabla) |
| editar | `scripts/notifications.sql` | agregar las tablas al consolidado |
| editar | `app/api/webhooks/asistencia/route.ts` | loop por materia + dedup en BD + tag por materia; deja de tocar `asistencia_agent_status` |
| nuevo | `app/api/admin/notifications/test-send/route.ts` | envío de prueba (email / todos) |
| nuevo | `app/api/asistencia/worker/heartbeat/route.ts` | recibe heartbeat con métricas (secret) |
| nuevo | `app/api/asistencia/worker/comando/route.ts` | GET (supervisor toma comando) + POST (ack), secret |
| nuevo | `app/api/admin/asistencia-workers/route.ts` | GET lista de workers + `conectado` calculado |
| nuevo | `app/api/admin/asistencia-workers/comando/route.ts` | POST encola comando (admin) |
| borrar | `app/api/asistencia/agent/route.ts` | reemplazado por `worker/heartbeat` |
| nuevo | `app/admin/dashboard/_components/AsistenciaWorkerSection.tsx` | monitor + botones de control |
| editar | `app/admin/dashboard/_components/AdminDashboardClient.tsx` | monta sección de prueba + monitor |
| editar | `app/admin/_components/AdminPanelClient.tsx` | quita el componente `AgentStatus` (tabla retirada) |

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
5. **Monitor**: con el daemon corriendo, `/admin/dashboard` muestra "Conectado —
   hace N m", RT y contadores que suben poll a poll. Cortar el daemon (Ctrl+C) →
   a los ~30s pasa a rojo con "cierre limpio (señal SIGINT)". Matar la ventana a
   la fuerza → rojo con "sin señal desde HH:MM".
6. **Comandos**: desde el monitor, "Reiniciar" → fila `pendiente` en
   `worker_comandos`; con el supervisor corriendo, el daemon sale y vuelve en
   segundos, la fila queda `ejecutado`. "Parar" → el supervisor no lo relanza.
   "Arrancar" → vuelve. Sin supervisor: el botón encola igual y el monitor
   muestra "sin respuesta del supervisor" pasado un timeout.
7. **Supervisor**: `.\start.ps1`; matar el daemon hijo desde el Task Manager →
   el supervisor lo relanza con backoff (ver logs). Reiniciar la PC con la tarea
   de Task Scheduler instalada → supervisor + daemon levantan solos.
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
