# Almacenamiento offline (PWA) — Diseño

Fecha: 2026-08-21

## Objetivo

Que Campus UTN, cuando se usa instalada como PWA, guarde por defecto los
datos de lectura del usuario (materias, horarios, notas, agenda, secciones
de curso, notas/inasistencias de Sysacad) y, de forma opt-in, los archivos
que el usuario abre — para que sigan disponibles sin conexión a internet.
Las acciones que escriben datos (login, inscripciones, cambio de
contraseña, foro, notificaciones, admin) requieren conexión siempre y
muestran un aviso claro en vez de fallar en silencio.

## Alcance

**Dentro de esta spec:**
- Identidad de usuario para preferencias offline (tabla `offline_preferences`).
- Modal de onboarding (solo PWA, primera visita a `/materias`).
- Sección "Almacenamiento offline" en `/configuracion` (toggle + acordeón de archivos).
- Guardado automático de archivos vía IndexedDB (`lib/offlineFileCache.ts`).
- Cache offline de datos vía Service Worker (`public/sw.js` extendido).
- Modales "requiere conexión" para acciones de escritura (incluye Sysacad interactivo).
- Chip "Modo Offline" en el header.
- Freno ante espacio insuficiente en el dispositivo.
- Integración con el sistema de error tracking existente (`lib/clientErrorReporter.ts` → `/api/errors` → tabla `error_events`).

**Fuera de esta spec (no se toca):**
- El manejo de Web Push en `public/sw.js` (evento `push`, `notificationclick`) — se extiende el archivo, no se reemplaza.
- Cualquier lógica de escritura/interacción de Sysacad (inscripción, cambio de contraseña) — se bloquea offline, no se cachea ni se intenta replicar.
- `/api/files` no se cachea vía Service Worker (lo cubre el mecanismo de IndexedDB por archivo).
- Login/logout (`/api/auth`) nunca se cachea ni funciona offline.

## Identidad de usuario

No existe email real capturado en ningún lugar del sistema (confirmado por
exploración de código: la cookie `moodle_user` solo trae `userid`,
`fullname`, `username`; la columna "email" en `perfil_notificaciones`
almacena en realidad el `username` de Moodle). Se reutiliza el mismo
patrón `getUserKey()` ya usado en 6 rutas API: identidad = `username` (o
`userid` como fallback) de la cookie `moodle_user`.

## Modelo de datos

Nueva tabla Supabase `offline_preferences`:

| columna | tipo | uso |
|---|---|---|
| `username` | text (PK) | identidad del usuario (Moodle) |
| `files_enabled` | boolean, default `false` | estado del toggle de guardado de archivos |
| `onboarding_seen_at` | timestamptz \| null | si ya vio el modal de onboarding |
| `updated_at` | timestamptz | auditoría |

Nueva ruta `app/api/offline-preferences/route.ts`:
- `GET`: devuelve `{ filesEnabled, onboardingSeen }` para el usuario autenticado (mismo patrón de auth que `app/api/sessions/route.ts`).
- `POST`: upsert de `files_enabled` y/o `onboarding_seen_at`.

## Modal de onboarding

- Trigger: `window.matchMedia('(display-mode: standalone)').matches` (+ fallback `navigator.standalone` en iOS) **y** `onboardingSeen === false`, evaluado al montar `/materias`.
- Contenido: explica que la app guarda materias/horarios/notas/agenda automáticamente, y pregunta si además querés guardar archivos para verlos sin internet. Botones **Activar** / **Ahora no**.
- Al elegir cualquiera de las dos: `POST /api/offline-preferences` con `onboardingSeenAt: now()` y `filesEnabled` según elección.
- Diseño visual: construido con el skill `frontend-design`, estilo iOS-HIG consistente con el resto de la app, modal centrado y fijo en viewport, dimensionado para mobile.

## Sección "Almacenamiento offline" en /configuracion

Nuevo bloque debajo de las secciones existentes (tema, sesiones):

1. **Toggle "Guardar archivos para uso offline"** — lee/escribe `files_enabled` vía `/api/offline-preferences`.
2. **"Espacio usado"** — suma de bytes de los blobs guardados en IndexedDB. Si se detectó espacio insuficiente (ver sección "Freno de espacio"), muestra aviso: "Espacio insuficiente en el dispositivo — borrá algunos archivos para seguir guardando offline."
3. **Acordeón "Archivos descargados"**, agrupado por materia:
   - Cada fila: ícono SVG según tipo de archivo (PDF, DOCX, XLSX, PPTX, etc.), con color de fondo distinto por tipo — paleta definida con el skill `frontend-design` siguiendo el lenguaje visual iOS-HIG existente.
   - Archivos ordenados dentro de cada materia por peso (mayor a menor).
   - Botón borrar por archivo.
   - Botón "Borrar todos los apuntes de esta materia" por grupo.
   - Botón global "Borrar todo" arriba del acordeón.
   - Si no hay archivos guardados, estado vacío ("No hay archivos guardados") o el acordeón se oculta.

## Guardado automático de archivos (IndexedDB)

`lib/offlineFileCache.ts` — mismo patrón que `lib/ocrCache.ts`:
- IndexedDB `campus-offline-files`, store `files`.
- Registro: `{ key, materiaId, materiaNombre, fileName, mimeType, sizeBytes, blob, savedAt }`. `key` = el `ref` opaco que ya usa `/api/files?ref=...`.
- API: `saveFile`, `getFile`, `deleteFile`, `deleteFilesByMateria(materiaId)`, `clearAll`, `listFiles`, `getTotalSize`.
- Integración en `components/CourseFileViewer.tsx` y `components/FolderViewer.tsx`: si `files_enabled === true`, tras un fetch exitoso se guarda el blob en background (no bloquea UI). Si el fetch falla, antes de mostrar error se intenta `getFile(key)`.
- Todas las operaciones con try/catch: en éxito silencioso, en fallo además de degradar sin romper la UI, se reporta vía `reportClientError("warning", mensaje, { stack })` (ver "Integración con error tracking").

## Cache offline de datos (Service Worker)

Se extiende `public/sw.js` (hoy solo maneja `push`/`notificationclick`) agregando un handler `fetch`.

**Nunca se cachea** (siempre pasa directo a la red):
- `/api/auth`
- `/api/files` (Range headers — cubierto por IndexedDB, sección anterior)
- `/api/offline-preferences`, `/api/errors`, `/api/admin/*`
- Cualquier request con header `Range`
- Cualquier request no-GET excepto el caso especial de `/api/moodle` (ver abajo)
- Cualquier acción de escritura de Sysacad (inscripción, cambio de contraseña, y en general cualquier endpoint de trámite)

**Sí se cachea:**
- **Navegación** (HTML de páginas): *network-first* → guarda copia en éxito, sirve cache en fallo, si no hay nada guardado muestra fallback de "Sin conexión".
- **Assets estáticos** (`_next/static/*`, íconos, fuentes): *cache-first* (nombres con hash, seguros de servir siempre desde cache).
- **`/api/moodle` (POST)**: se intercepta, se arma una clave estable a partir de `methodname` + `args` (JSON estable), se guarda/lee la respuesta bajo esa clave usando un `Request` sintético GET como key de Cache API. Cubre materias, notas de Sysacad-vía-Moodle si aplica, etc.
- **Rutas GET de datos propias** (`/api/course`, horarios/notas/agenda, notas/inasistencias de Sysacad de solo lectura): *network-first con fallback a cache*.

**Versionado**: sin precache por build-id — cada respuesta se re-guarda apenas hay red, autocurando el cache sin necesidad de invalidación manual por deploy.

**Registro**: se registra de forma temprana y global en `instrumentation-client.ts` (ya usado para error tracking), `scope: '/'`. El registro existente en `/notificaciones` sigue funcionando igual (registro idempotente).

**Blindaje**: si el navegador no soporta Service Workers o el registro falla, la app funciona igual que hoy (degradación total a "sin offline"), nunca bloquea el flujo normal.

## Modales "requiere conexión"

Hook `useRequireOnline()`: chequea `navigator.onLine` antes de ejecutar una acción de escritura. Si está offline, muestra un modal "Esta acción necesita conexión a internet" (botón OK) en vez de intentar y fallar en silencio.

Se aplica a: inscripción a materias, cambio de contraseña, publicar en foro/mensajería, vincular Telegram, activar notificaciones push, acciones de panel admin, descargar un archivo nunca guardado antes.

**Sysacad**: separado por tipo de acción —
- Lectura (notas, inasistencias, situación académica): cacheada normal (network-first + fallback), disponible offline.
- Escritura/interacción (inscribirse, cambiar contraseña, trámites): siempre bloqueada offline con el modal, nunca se cachea ni se intenta.

Diseño visual construido con el skill `frontend-design`, mismo lenguaje visual iOS-HIG que el resto de la app.

## Chip "Modo Offline" en el header

`components/OfflineStatusChip.tsx`: escucha eventos `online`/`offline` del navegador. Mientras el dispositivo está sin conexión, muestra un chip verde con un punto parpadeando (animación CSS) y texto "Modo Offline" en el header. Al reconectar, desaparece automáticamente.

## Freno ante espacio insuficiente

Antes de cada guardado automático (archivos en IndexedDB, respuestas cacheadas por el SW):
- Se chequea `navigator.storage.estimate()` cuando está disponible.
- Cada escritura está envuelta en try/catch capturando específicamente `QuotaExceededError`.
- Al detectar que no hay espacio: se activa una bandera en memoria que corta el guardado automático por el resto de la sesión (evita reintentos fallidos repetidos), se reporta una vez vía `reportClientError` (el dedupe existente evita saturar el log), y se refleja el aviso en la sección "Espacio usado" de `/configuracion`.

## Integración con error tracking

Se reutiliza el sistema existente sin cambios: `lib/clientErrorReporter.ts::reportClientError(severity, message, extra)` → `POST /api/errors` → tabla `error_events` en Supabase → visible en `app/admin/dashboard/_components/ErrorEventsModal.tsx`. El campo `section` ya lo captura automáticamente el reporter (`window.location.pathname`), permitiendo filtrar por sección y ver qué usuarios tuvieron fallos de guardado offline (con mensaje, stack y consola incluidos).

Puntos de reporte:
- Fallos de guardado/lectura/borrado en `lib/offlineFileCache.ts`.
- Fallos de cacheo/lectura en el Service Worker (vía `postMessage` al cliente, que a su vez llama `reportClientError`, ya que el SW no tiene acceso directo al reporter que vive en el hilo principal).
- Detección de espacio insuficiente (`QuotaExceededError`).

## Qué queda offline vs online (resumen)

**Offline:** materias, horarios, notas, agenda, secciones/contenido de curso, notas e inasistencias de Sysacad, archivos previamente abiertos (si el toggle estaba activo), navegación entre páginas ya visitadas.

**Requiere internet siempre:** login/logout, inscripciones y cambio de contraseña en Sysacad, foro/mensajería/chat, notificaciones push y Telegram, panel de administración, descargar un archivo nunca abierto antes.

## Riesgos y mitigaciones

- **Romper el streaming de archivos con Range headers**: mitigado excluyendo `/api/files` por completo del Service Worker; se maneja aparte vía IndexedDB con el archivo completo.
- **Cachear accidentalmente respuestas con datos sensibles/cookies de sesión**: mitigado con lista explícita de exclusión (`/api/auth`, `/api/admin/*`, etc.) y cacheando solo GET (+ el caso especial controlado de `/api/moodle`).
- **App rota si el Service Worker falla o no está soportado**: mitigado por diseño — todo es progressive enhancement, nunca bloquea el flujo normal.
- **Espacio del dispositivo lleno**: mitigado por el freno descripto arriba.
- **Staleness de datos offline**: aceptado y comunicado — el usuario ve la "última foto" hasta reconectar; no requiere solución adicional para esta iteración.
