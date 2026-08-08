# Métricas de inicios de sesión en /admin/dashboard — diseño

## Contexto

El admin quiere saber si el Campus se usa: cuántas **personas distintas**
(no cuántos inicios de sesión totales) ingresan por día o por mes, con un
filtro de fecha y una lista buscable de los mails que ingresaron.

Hoy no existe ningún registro histórico de logins. La tabla `device_sessions`
(`lib/deviceSessions.ts`) es un *upsert* por dispositivo (una fila por
`device_id`, se sobreescribe en cada login/keep-alive) — sirve para "cerrar
sesión en otro dispositivo" pero no para reconstruir cuántas personas
distintas entraron un día dado, porque no conserva historial.

## Qué cuenta como "ingreso"

Se investigaron los tres puntos de entrada de la app y se decidió:

- **Login explícito con usuario/contraseña** (`POST /api/auth`, éxito) → se
  registra. Es el único evento que representa "esta persona entró hoy" sin
  ruido: el `GET /api/auth` (keep-alive / re-login silencioso con
  credenciales guardadas) **no** se registra, para no inflar la métrica con
  pings automáticos de tabs abiertos.
- **Modo invitado** (`GET /api/guest/login`) → se registra con
  `user_key = "invitado"`. No hay forma de distinguir personas distintas
  dentro del modo invitado (siempre el mismo usuario genérico Moodle/Sysacad),
  así que todos los accesos guest cuentan como una sola "persona" por período.
- **`GET /api/auth/google/callback`** → **no** se registra. No es un login de
  usuario del Campus: es la conexión de Google Drive del admin (guarda un
  refresh token para leer archivos de Drive) y no identifica a ninguna
  persona.

## Modelo de datos

Tabla nueva en Supabase, `login_events` (histórico append-only). A crear
manualmente en el panel de Supabase, igual que se hizo con `device_sessions`
— no hay migraciones automatizadas en este repo:

```sql
create table login_events (
  id bigserial primary key,
  user_key text not null,        -- username/mail de Moodle, o 'invitado'
  fullname text,
  source text not null check (source in ('moodle', 'guest')),
  created_at timestamptz not null default now()
);
create index login_events_created_at_idx on login_events (created_at);
```

## Instrumentación

Nuevo `lib/loginEvents.ts`, con el mismo patrón best-effort/try-catch
silencioso que `lib/deviceSessions.ts` (si Supabase falla o la tabla no
existe, el login no se rompe):

```ts
export async function logLoginEvent(params: {
  userKey: string;
  fullname?: string | null;
  source: "moodle" | "guest";
}): Promise<void>
```

Puntos de llamada:

- `app/api/auth/route.ts`, dentro del `POST`, después de `moodleLogin`
  exitoso: `logLoginEvent({ userKey: session.username, fullname:
  session.fullname, source: "moodle" })`.
- `app/api/guest/login/route.ts`, dentro del `GET`:
  `logLoginEvent({ userKey: "invitado", fullname: "Invitado", source: "guest" })`.

## API para el admin

Dos rutas nuevas bajo `/api/admin`, protegidas con `isAdminRequest` (mismo
chequeo que usan `login`/`logout`). La agregación se hace en JS sobre las
filas devueltas por Supabase (sin función SQL) — el volumen esperado no
justifica esa complejidad.

### `GET /api/admin/login-stats?granularity=day|month&from=&to=`

```ts
{
  series: { period: string; distinctUsers: number }[]; // period: "YYYY-MM-DD" o "YYYY-MM"
  todayDistinctUsers: number; // siempre "hoy" real, independiente de from/to
}
```

Si `from`/`to` no vienen: default a últimos 30 días (`day`) o últimos 12
meses (`month`).

### `GET /api/admin/login-events?from=&to=&q=`

Devuelve personas distintas (no el log crudo), agregadas en el rango:

```ts
{
  users: {
    userKey: string;
    fullname: string | null;
    loginCount: number;
    lastLoginAt: string; // ISO
  }[];
}
```

`q` filtra por coincidencia parcial (case-insensitive) en `userKey` o
`fullname`. Mismo rango de fechas que el gráfico.

## UI

Nueva sección en `/admin/dashboard`, debajo del bloque "Herramientas"
existente en `AdminDashboardClient.tsx`. Se separa en componentes propios
para no engordar ese archivo:

- **`app/admin/dashboard/_components/LoginStatsSection.tsx`**
  - Tarjeta destacada: "Personas distintas hoy: N" (de `todayDistinctUsers`,
    no cambia con el filtro de fecha).
  - Toggle segmentado estilo iOS: Diario / Mensual. Al cambiar de modo, si el
    usuario no tocó el filtro de fecha manualmente, se resetea al default de
    ese modo (30 días / 12 meses).
  - Filtro de fecha: dos `<input type="date">` (Desde/Hasta).
  - Gráfico de barras (`recharts`), reusando `useChartColors` y
    `ChartTooltip` de `components/sysacadws/charts/common.tsx` para
    consistencia visual y dark mode. Eje X = período, eje Y = personas
    distintas.
  - Botón "Ver mails" que abre el modal.
- **`app/admin/dashboard/_components/LoginEventsModal.tsx`**
  - Input de búsqueda (filtra por `q` contra la API, con debounce).
  - Lista: mail, nombre, cantidad de logins en el rango, fecha del último
    ingreso. Respeta el mismo rango de fechas que el gráfico al momento de
    abrirse.

`AdminDashboardClient.tsx` solo importa y renderiza `<LoginStatsSection />`
en una sección nueva, sin lógica propia.

## Manejo de errores

Todo lo relacionado a `login_events` es best-effort en el camino de
escritura (login nunca falla por esto). En el camino de lectura (rutas admin
y UI), si Supabase no responde o la tabla no existe todavía, las rutas
devuelven listas/series vacías con status 200 — la sección muestra un estado
vacío ("Sin datos en este rango") en vez de romper el dashboard.

## Fuera de alcance

- No se registra el keep-alive/re-login silencioso (`GET /api/auth`).
- No se registra la conexión de Google Drive.
- No hay deduplicación ni distinción de personas dentro del modo invitado.
- No hay función SQL de agregación en Supabase; se agrega en JS.
