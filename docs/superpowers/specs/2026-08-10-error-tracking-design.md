# Tracking de errores de toda la web en /admin/dashboard — diseño

## Contexto

Hoy no existe ningún registro de errores de la aplicación (ni cliente ni
servidor) — no hay `error.tsx`, `instrumentation.ts`, ni tabla de errores en
Supabase. El admin quiere una vista en `/admin/dashboard` con la cantidad de
errores agrupados por criticidad, y poder ver el detalle de cada error
(fecha, sección de la web donde ocurrió, y la consola del navegador en ese
momento) con un botón para copiar toda esa info.

Esto requiere instrumentar **toda la web**: errores de React que rompen la
pantalla, errores de JS no capturados en el navegador, `console.warn`/
`console.error`, y errores del lado del servidor (las 64 API routes bajo
`app/api/**` y el render de páginas). Se usan los hooks nativos de Next.js
16 (`instrumentation.ts` con `onRequestError`, `instrumentation-client.ts`)
para lograr esto sin tocar cada route handler o componente uno por uno.

## Niveles de criticidad

Tres niveles, asignados automáticamente según el origen del error (no hace
falta que el código que reporta elija un nivel):

- **`critical`**: rompió la pantalla para el usuario — un error boundary de
  React (`app/error.tsx`, `app/global-error.tsx`) atrapó la excepción, o el
  servidor falló renderizando una página (`context.routeType === "render"`
  en `onRequestError`).
- **`error`**: excepción no capturada pero que no rompió toda la pantalla —
  `window.onerror`, `unhandledrejection`, `console.error(...)`, o una
  excepción en una API route del servidor (`context.routeType !== "render"`).
- **`warning`**: `console.warn(...)` en el navegador.

## Modelo de datos

Tabla nueva en Supabase, `error_events` (histórico append-only). A crear
manualmente en el panel de Supabase, igual que el resto de las tablas de
este repo — no hay migraciones automatizadas:

```sql
create table error_events (
  id bigserial primary key,
  severity text not null check (severity in ('critical', 'error', 'warning')),
  source text not null check (source in ('client', 'server')),
  message text not null,
  stack text,
  section text,               -- pathname donde ocurrió (cliente) o request.path (servidor)
  console_log jsonb,          -- últimas entradas de consola antes del error (solo cliente)
  request_info jsonb,         -- method/path/routeType/routePath (solo servidor)
  user_agent text,
  created_at timestamptz not null default now()
);
create index error_events_created_at_idx on error_events (created_at);
create index error_events_severity_idx on error_events (severity);
```

Se agrega a `scripts/error-events.sql`, siguiendo el patrón de
`scripts/notifications.sql`.

## Instrumentación

### `lib/errorEvents.ts`

Mismo patrón best-effort que `lib/loginEvents.ts` (nunca lanza, si Supabase
falla se pierde el reporte en silencio):

```ts
export async function logErrorEvent(params: {
  severity: "critical" | "error" | "warning";
  source: "client" | "server";
  message: string;
  stack?: string | null;
  section?: string | null;
  consoleLog?: ConsoleEntry[] | null;
  requestInfo?: Record<string, unknown> | null;
  userAgent?: string | null;
}): Promise<void>

export async function fetchErrorEventsInRange(fromISO: string, toISO: string): Promise<ErrorEventRow[]>
```

`lib/errorEventStats.ts` (puro, sin I/O — mismo rol que `loginEventStats.ts`,
comparte la lógica de fechas en hora Argentina vía `periodKey`/
`resolveDateRange` ya existentes en `loginEventStats.ts`, que se reexportan):

```ts
export function buildSeverityStats(rows: ErrorEventRow[]): { critical: number; error: number; warning: number }

export function buildSeveritySeries(
  rows: ErrorEventRow[],
  granularity: Granularity,
  fromISO: string,
  toISO: string
): { period: string; critical: number; error: number; warning: number }[]
```

### Cliente — `instrumentation-client.ts` (nuevo, raíz del proyecto)

Corre una vez, antes de la hidratación:

- Parchea `console.warn` y `console.error`: cada llamada se agrega a un ring
  buffer en memoria (últimas 30 entradas, con timestamp) y además dispara un
  reporte (`console.warn` → severidad `warning`, `console.error` → severidad
  `error`), incluyendo el buffer de consola *previo* a esa entrada como
  contexto.
- `window.addEventListener("error", ...)` y `("unhandledrejection", ...)` →
  severidad `error`, con el buffer de consola reciente adjunto.
- Todo reporte cliente incluye `section = location.pathname` y
  `userAgent = navigator.userAgent`.
- **Deduplicación**: un `Map<string, number>` en memoria de
  `` `${severity}:${message}:${section}` `` → timestamp del último envío. Si
  el mismo error se repite dentro de los 30s, no se reenvía (evita inundar
  Supabase con un error en loop). Tope duro de 50 reportes por sesión de
  pestaña.
- Envía cada reporte a `POST /api/errors` (fetch con `keepalive: true`).
- Exporta `reportClientError(severity, message, extra)` para que la usen los
  error boundaries de React.

### React error boundaries (nuevos — no existen hoy)

- **`app/error.tsx`**: boundary a nivel raíz de rutas de página. Client
  Component; en `useEffect` llama
  `reportClientError("critical", error.message, { stack: error.stack })`.
  UI de fallback simple estilo iOS: "Algo salió mal" + botón "Reintentar"
  (`unstable_retry`).
- **`app/global-error.tsx`**: boundary del root layout (errores fuera de
  `app/error.tsx`). Mismo reporte, con su propio `<html>`/`<body>` mínimo
  como exige Next.js.

### Servidor — `instrumentation.ts` (nuevo, raíz del proyecto)

```ts
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  await logErrorEvent({
    severity: context.routeType === "render" ? "critical" : "error",
    source: "server",
    message: err.message,
    stack: err.stack ?? null,
    section: request.path,
    requestInfo: {
      method: request.method,
      routeType: context.routeType,
      routePath: context.routePath,
      digest: (err as { digest?: string }).digest,
    },
    userAgent: pickHeader(request.headers, "user-agent"),
  });
};
```

Llama directo a `logErrorEvent` (corre en el servidor, no hace falta pegarle
a un endpoint HTTP). **No** se guardan `cookie` ni `authorization` de
`request.headers` — solo se extrae `user-agent` con un allowlist explícito,
para no filtrar tokens de sesión a la tabla de errores.

### Endpoint de ingesta — `POST /api/errors` (nuevo, sin auth)

Recibe los reportes de `instrumentation-client.ts`. Sin autenticación, igual
que el resto de la telemetría del Campus (`login_events`, `web_push`). Valida
la forma del body y trunca `message`/`stack`/`console_log` a un tamaño
razonable (ej. 4000 caracteres) antes de guardar, para no aceptar payloads
arbitrariamente grandes. Llama a `logErrorEvent({ ...body, source: "client" })`.

## API para el admin

Dos rutas nuevas bajo `/api/admin`, protegidas con `isAdminRequest` (mismo
chequeo que `login-stats`/`login-events`):

### `GET /api/admin/error-stats?granularity=day|month&from=&to=`

```ts
{
  series: { period: string; critical: number; error: number; warning: number }[];
  todayCounts: { critical: number; error: number; warning: number };
}
```

Mismos defaults de rango que `login-stats` (últimos 30 días / 12 meses).

### `GET /api/admin/error-events?from=&to=&severity=&q=`

```ts
{
  events: {
    id: number;
    severity: "critical" | "error" | "warning";
    source: "client" | "server";
    message: string;
    stack: string | null;
    section: string | null;
    consoleLog: { level: string; args: string; at: string }[] | null;
    requestInfo: Record<string, unknown> | null;
    userAgent: string | null;
    createdAt: string; // ISO
  }[];
}
```

`severity` (opcional) filtra por nivel. `q` filtra por coincidencia parcial
(case-insensitive) en `message` o `section`. Mismo rango de fechas que el
gráfico. Ordenado por `created_at` descendente.

## UI

Nueva sección **"Errores"** en `/admin/dashboard`, debajo de "Uso del
Campus" en `AdminDashboardClient.tsx`:

- **`app/admin/dashboard/_components/ErrorStatsSection.tsx`**
  - Igual estructura que `LoginStatsSection`: toggle Diario/Mensual, filtro
    de fecha, gráfico de barras (`recharts`).
  - Barras **apiladas** por severidad (`critical`/`error`/`warning`), cada
    una con su color (rojo/naranja/amarillo, coherentes con el resto de la
    UI — ej. `#ff3b30`/`#ff9500`/`#ffcc00`).
  - Tres chips con el total de **hoy** por severidad (no cambian con el
    filtro de fecha), igual que "Personas distintas hoy".
  - Botón "Ver más" abre `ErrorEventsModal`.
- **`app/admin/dashboard/_components/ErrorEventsModal.tsx`**
  - Buscador (debounce) + filtro por severidad (segmented control:
    Todos/Crítico/Error/Warning).
  - Lista de errores individuales, más reciente primero: severidad (badge de
    color), mensaje, sección, fecha.
  - Cada fila es expandible (acordeón): muestra stack trace completo,
    consola reciente (cliente) o info de request (servidor), user agent.
  - Botón **"Copiar"** en cada fila expandida: arma un bloque de texto plano
    con toda la info (severidad, fecha, sección, mensaje, stack, consola/
    request info) y lo copia con `navigator.clipboard.writeText`.

`AdminDashboardClient.tsx` solo importa y renderiza `<ErrorStatsSection />`,
sin lógica propia — mismo patrón que `LoginStatsSection`.

## Manejo de errores

- Todo el camino de **escritura** (`logErrorEvent`, `onRequestError`, el
  patch de `console.*`) es best-effort: si Supabase falla o la tabla no
  existe, no rompe nada de la app (ni el error original ni la request).
- El propio `POST /api/errors` nunca debe poder tirar un error no capturado
  que dispare otro reporte — todo el handler va en try/catch.
- El patch de `console.error`/`console.warn` llama siempre a la función
  original de `console` primero, y el envío del reporte va en un
  `try/catch` separado, para no alterar el comportamiento normal de logging
  ni crear un loop si el propio reporte falla y logea con `console.error`
  (se usa `console.error` original, no la versión parcheada, para cualquier
  log interno del propio sistema de tracking).
- En el camino de **lectura** (rutas admin y UI), si Supabase no responde,
  las rutas devuelven listas/series vacías con status 200 — la sección
  muestra "Sin datos en este rango" en vez de romper el dashboard.

## Fuera de alcance

- No hay alertas/notificaciones en tiempo real cuando ocurre un error
  crítico (solo queda registrado, visible en el dashboard).
- No hay agrupación de errores repetidos en un solo "issue" (cada ocurrencia
  es una fila, más allá de la deduplicación de envío de 30s en el cliente).
- No se capturan errores de Service Worker / PWA fuera del hilo principal.
- No hay función SQL de agregación en Supabase; se agrega en JS, igual que
  `login-stats`.
