# Notificaciones de asistencia — daemon local + pruebas desde admin

Fecha: 2026-09-02
Estado: aprobado (diseño)

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
- Heartbeat a `/api/asistencia/agent` igual que hoy (`status: "listening"` con
  `activeOptions`; `status: "detected"` tras un envío). `agent_id` sigue siendo
  `"motorola-local"` para no romper la card de `/admin/testnotis` (se puede
  parametrizar con `ASISTENCIA_AGENT_ID` pero el default se mantiene).
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
3. `updateAgentStatus("detected", payload)` (igual que hoy).
4. Calcular `excludeUserKeys` una sola vez (igual que hoy).
5. **Por cada** materia de `activeOptions`:
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
6. Responder `{ ok: true, materias: [{ materiaId, skipped|sent, ... }] }`.

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

## Variables de entorno

**Ya en Vercel (no cambian):** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (opcional), `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NOTIFICATIONS_WEBHOOK_SECRET`, `SESSION_SECRET`.

**Nuevas, sólo en `scripts/asistencia-daemon/.env` (local, gitignoreado):**
`CAMPUS_APP_URL`, `NOTIFICATIONS_WEBHOOK_SECRET` (copia del de Vercel),
`ASISTENCIA_USER`, `ASISTENCIA_PASSWORD` (o `ASISTENCIA_COOKIE`),
`ASISTENCIA_POLL_MS` (opcional), overrides opcionales del form de login.

## Archivos

| Acción | Archivo | Motivo |
|---|---|---|
| nuevo | `scripts/asistencia-daemon/daemon.mjs` | porta `agent.js`, sin estado local, loop por materia |
| nuevo | `scripts/asistencia-daemon/start.ps1` | arranque |
| nuevo | `scripts/asistencia-daemon/.env.example` | plantilla config |
| nuevo | `scripts/asistencia-daemon/.gitignore` | ignora `.env` |
| nuevo | `scripts/asistencia-daemon/README.md` | uso + mover a otra PC + usuarios nuevos |
| borrar | `agent.js` | reemplazado por el daemon |
| nuevo | `scripts/asistencia-avisos-log.sql` | tabla de dedup |
| editar | `scripts/notifications.sql` | agregar la tabla al consolidado |
| editar | `app/api/webhooks/asistencia/route.ts` | loop por materia + dedup en BD + tag por materia |
| nuevo | `app/api/admin/notifications/test-send/route.ts` | envío de prueba (email / todos) |
| editar | `app/admin/dashboard/_components/AdminDashboardClient.tsx` | sección de prueba |

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
   al webhook. Confirmar heartbeat en la card de `/admin/testnotis`.
5. **Admin**: en `/admin/dashboard`, "Enviar a este usuario" con el propio email
   → llega a este dispositivo; con un email sin suscripciones → 404 con mensaje.
   "Enviar a todos" → llega el resultado con `total`/`sent`.
6. **PWA iOS + Android**: instalar la app en un iPhone y un Android, activar
   notificaciones, disparar "Enviar a todos" y un aviso de asistencia real →
   ambas llegan y al tocarlas abren `/asistencia`.

## Fuera de alcance

- Filtrado del aviso por materia por usuario (requiere credenciales de legacy por
  alumno — no disponibles).
- Migrar el daemon a cron en la nube (el diseño lo deja posible; no se hace ahora).
- Notificaciones por Telegram para asistencia (el canal Telegram existente es
  para tareas; no se toca).
- Cambios en `public/sw.js` (el handler actual ya cubre este payload).
