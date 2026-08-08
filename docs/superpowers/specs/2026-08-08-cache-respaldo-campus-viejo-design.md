# Cache de respaldo del campus viejo (Moodle) — diseño

## Contexto

Toda la información de materias (lista de cursos, secciones, módulos,
archivos) se trae en vivo scrapeando o pegándole al AJAX de
`https://frsfco.cvg.utn.edu.ar` (`lib/moodle.ts`, `app/api/course/route.ts`,
`app/api/courses/route.ts`, `app/api/moodle/route.ts`). No hay ninguna copia
persistente: `lib/hooks.ts` guarda un cache en memoria (`cachedCourses`,
`cachedCourseContents`) que solo dura mientras el tab está abierto y
desaparece al recargar.

Si el campus viejo deja de responder (caída, mantenimiento, migración,
decomisión), hoy la app deja de mostrar cualquier contenido de materias,
aunque ya se haya visto antes. El objetivo es que la app vaya "aprendiendo"
con cada visita — guardando en Supabase lo que ya trajo con éxito — para
poder mostrar esa última copia conocida cuando Moodle no responde, sin
depender de que el usuario haya dejado el tab abierto.

## Alcance

Incluido:
- Contenido de materias (secciones/módulos) — `app/api/course/route.ts`.
- Lista de materias inscriptas del dashboard — `app/api/courses/route.ts` y
  los dos `methodname` de listado de cursos en `app/api/moodle/route.ts`.
- Sesiones más largas para reducir la chance de quedar sin poder entrar si
  Moodle está caído justo cuando haría falta re-loguear.

Fuera de alcance (fase futura si hace falta):
- Los archivos en sí (PDF/DOCX/etc.) — se sigue necesitando Moodle arriba
  para descargarlos, incluso con este cache.
- Catálogo de materias para auto-matricularse (`app/api/campus/catalogo`) —
  matricularse requiere Moodle igual, así que cachear el catálogo no
  desbloquea nada mientras Moodle esté caído.
- Cron/job periódico que recorra materias sin que nadie las visite. El cache
  se llena únicamente por *write-through* (lo que la gente ya visita).

## Modelo de datos

Tabla nueva en Supabase, `moodle_cache` (clave-valor genérico). A crear
manualmente en el panel de Supabase, como el resto de las tablas del
proyecto — no hay migraciones automatizadas en este repo:

```sql
create table moodle_cache (
  cache_key text primary key,   -- "course:<courseId>" | "courses:<userid>"
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
```

Una sola tabla key/value en vez de tablas relacionales por sección/módulo:
el JSON que ya arma cada endpoint hoy (`{ sections, courseName }` o el array
de `MoodleCourse`) se guarda tal cual, sin normalizar. Si en el futuro se
cachea otro recurso, alcanza con un prefijo de key nuevo.

Claves:
- `course:<courseId>` — contenido de una materia. Se comparte entre todos
  los alumnos inscriptos: la estructura de secciones/módulos no depende del
  usuario que la pidió.
- `courses:<userid>` — lista de materias inscriptas. Es por usuario, porque
  cada alumno está inscripto en cursos distintos. `userid` sale de la cookie
  `moodle_user`.

## `lib/contentCache.ts` (nuevo)

Mismo patrón best-effort que `lib/deviceSessions.ts`/`lib/loginEvents.ts`:
si Supabase falla o la tabla no existe todavía, no rompe el flujo normal.

```ts
export async function getCachedCourse(courseId: number): Promise<
  { sections: MoodleCourseSection[]; courseName: string } | null
>;
export async function setCachedCourse(
  courseId: number,
  data: { sections: MoodleCourseSection[]; courseName: string }
): Promise<void>; // fire-and-forget, no se espera en el camino de lectura

export async function getCachedCourses(userId: number): Promise<MoodleCourse[] | null>;
export async function setCachedCourses(userId: number, courses: MoodleCourse[]): Promise<void>;
```

`setCachedCourse`/`setCachedCourses` hacen upsert
(`moodle_cache?on_conflict=cache_key`, `Prefer: resolution=merge-duplicates`)
y se llaman sin `await` en el camino feliz, para no sumar latencia a la
respuesta que ya se le va a devolver al usuario.

## Cuándo se escribe

Después de un scrape/llamada exitosa a Moodle, en cada uno de los tres
puntos de entrada:

- `app/api/course/route.ts`: al final del `GET`, antes de responder, dispara
  `setCachedCourse(courseId, { sections, courseName })`.
- `app/api/courses/route.ts`: al final del `GET`, si `courses.length > 0`,
  dispara `setCachedCourses(userId, courses)` (el `userId` sale de
  `moodle_user`, que ya está disponible como cookie en el request).
- `app/api/moodle/route.ts`: solo para `methodname` igual a
  `core_course_get_enrolled_courses_by_timeline_classification` o
  `core_enrol_get_users_courses`, y solo si la respuesta trae cursos, dispara
  `setCachedCourses(userId, courses)`. El resto de los `methodname` (mensajes,
  notificaciones, etc.) no participan del cache: un fallo ahí es un error de
  verdad, no algo para tapar con datos viejos.

## Cuándo se lee (fallback)

Solo se consulta `moodle_cache` cuando la falla indica "Moodle no responde",
nunca cuando el problema es de sesión/autenticación:

| Situación | ¿Cae a cache? |
|---|---|
| El `fetch` a Moodle tira excepción (timeout, DNS, conexión rechazada) | Sí |
| Moodle responde 5xx | Sí |
| Moodle responde pero redirige a `/login/` (sesión vencida) | No — se mantiene el flujo actual (`401 Sesión expirada` / re-login automático vía `moodle_cred` en `app/api/auth/route.ts`) |
| Falta la cookie `moodle_session_token` | No — el usuario no está logueado, no es un problema de disponibilidad |

Si hay un valor cacheado para la key correspondiente, se devuelve con la
**misma forma de respuesta** que el camino en vivo (`{ data, courseName }` en
`/api/course`, `{ data }` en `/api/courses` y `/api/moodle`), para que
`lib/hooks.ts` y los componentes no necesiten saber si el dato vino de Moodle
o del respaldo. Si no hay nada cacheado para esa key, se devuelve el error
como hoy.

El fallback es **silencioso**: no se agrega ningún indicador de "datos
guardados" ni de fecha en la UI.

## Sesiones más resistentes

El checkbox "recordarme" se mantiene tal cual funciona hoy (solo persiste
sesión + credenciales cifradas si el usuario lo marca). Único cambio: subir
`REMEMBER_MAX_AGE` en `lib/cookies.ts` de 30 a 90 días, para que quien sí
marcó "recordarme" aguante cortes de Moodle más prolongados sin tener que
volver a loguearse manualmente. El resto del mecanismo de resiliencia
(`refreshMoodleSession` no mata la sesión ante error de red, re-login
automático con `moodle_cred` en `GET /api/auth`) ya existe y no cambia.

## Manejo de errores

- Escritura al cache: best-effort, nunca bloquea ni rompe la respuesta al
  usuario si Supabase falla.
- Lectura del cache: si Supabase falla al intentar leer el fallback, se
  devuelve el error original de Moodle (no se agrega un segundo tipo de
  error nuevo).

## Testing / verificación

No hay suite de tests automatizados en el proyecto; verificación manual:

1. Con Moodle arriba: entrar a una materia y al dashboard, confirmar en el
   panel de Supabase que aparecen las filas `course:<id>` y
   `courses:<userid>` en `moodle_cache`.
2. Simular caída (cambiar `MOODLE_BASE` a una URL que no resuelve, o cortar
   la red): recargar la misma materia y el dashboard, confirmar que se sigue
   viendo el contenido ya visto antes, sin mensaje de error.
3. Borrar las cookies de sesión y confirmar que el flujo de login normal
   sigue funcionando sin interferencia del cache.

## Fuera de alcance

- Respaldo de archivos (PDF/DOCX/etc.).
- Catálogo de auto-matriculación.
- Cron/job periódico independiente de las visitas de los usuarios.
- Indicador visual de "mostrando datos guardados".
