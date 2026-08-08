# Contactar Profesor — design

## Contexto

En `/materia/[slug]` (`app/materia/[slug]/page.tsx`) el header muestra "Materia / {nombre} / N secciones" pero no hay forma de contactar a los profesores de esa materia sin ir manualmente al chat y buscarlos por nombre. Se agrega un botón "Contactar Profesor" que abre un modal con los profesores de la materia (foto + nombre) y un acceso directo a iniciar/abrir el chat con cada uno.

La fuente de datos de profesores es la página de Participantes de Moodle (`user/index.php?id={courseId}`), scrapeada igual que `/api/course` y `/api/userprofile` ya scrapean otras páginas de Moodle (no hay web service disponible para esto, y aunque lo hubiera, el proxy de esta app ya sigue el patrón de scraping HTML autenticado con la cookie `moodle_session_token`). Referencia de la estructura de esa página: `harfiles/participantes/sourcefile.html`.

## Alcance

- Nuevo endpoint `GET /api/participants?id={courseId}` que devuelve solo los participantes con rol de profesor.
- Nuevo modal `ContactProfessorModal` que lista esos profesores y permite abrir el chat con uno.
- Botón "Contactar Profesor" en el header de `/materia/[slug]`.
- Soporte en `/chat` para abrir directamente una conversación (existente o nueva) a partir de un `userid` en la URL.

Fuera de alcance: mostrar profesores en otras vistas, cachear la lista de participantes, roles distintos a "Profesor".

## Backend: `app/api/participants/route.ts`

Mismo patrón que `app/api/userprofile/route.ts`:

```
GET /api/participants?id={courseId}
```

- Modo invitado (`isGuestRequest`): devuelve `{ professors: [] }` inmediatamente. No hace falta mock — el chat ya bloquea el envío de mensajes en modo invitado vía `triggerGuestBlock()`, así que no tiene sentido simular profesores reales.
- Requiere `moodle_session_token`; si falta, `401`.
- Valida `id` numérico; si falta o es inválido, `400`.
- Hace `fetch(`${MOODLE_BASE}/user/index.php?id={id}&perpage=5000`, { headers: { Cookie: `MoodleSession=${token}` } })` — `perpage=5000` evita la paginación por defecto de 20 (se ve en el HTML de referencia: `data-action="showcount" data-target-page-size="5000"`).
- Si la respuesta final redirige a `/login/`, devuelve `401`.
- Parsea la tabla `<table ... id="participants">`: para cada `<tr>` dentro de `<tbody>`:
  - `id` de usuario: del `href="user/view.php?id=(\d+)"` en la celda `c1`.
  - `name`: texto del `<a>` en la celda `c1` (después del `<img>`/`<span class="userinitials">`), decodificando entidades HTML.
  - `avatarUrl`: `src` del `<img class="userpicture">` si existe (absoluto, tal cual viene de Moodle — se reescribe a proxy en el paso final); `null` si el participante solo tiene iniciales (`<span class="userinitials">`).
  - `role`: texto de la celda `c2` (columna "Roles").
  - Se descartan filas cuyo `role` no contenga "Profesor" (cubre "Profesor" y "Profesor sin permiso de edición").
- Los `avatarUrl` no nulos se pasan por `toProxyPath` (de `lib/moodle.ts`, ya usado en `/api/course`) para no exponer el dominio real de Moodle, igual que hacen las imágenes de módulos.
- Respuesta: `{ professors: { id: number; name: string; avatarUrl: string | null }[] }`.
- Errores de red/parseo → `502` con `{ error: message }`, siguiendo el mismo estilo que `/api/course`.

No se pagina más allá de `perpage=5000` (una materia nunca va a tener miles de participantes en este campus) ni se cachea — se vuelve a pedir cada vez que se abre el modal, aceptable porque es lazy (solo se pide al tocar el botón).

## Frontend: `ContactProfessorModal`

Nuevo archivo `components/ContactProfessorModal.tsx`, mismo lenguaje visual iOS que `ComingSoonModal.tsx` (backdrop con blur, tarjeta `rounded-3xl`, botón de cerrar arriba a la derecha).

Props:
```ts
interface Props {
  courseId: number;
  open: boolean;
  onClose: () => void;
}
```

Comportamiento:
- Al pasar de `open=false` a `open=true`, dispara `fetch('/api/participants?id=' + courseId)` (sin SWR — es una carga puntual, no necesita revalidación ni caché entre aperturas del modal).
- Estados: `loading` (spinner, usando `Spinner` de `components/Spinner.tsx`), `error` (mensaje simple + reintentar), `professors` vacío ("No se encontraron profesores para esta materia."), lista de profesores.
- Cada fila: avatar (foto si `avatarUrl`, si no iniciales con `avatarColor`/`getInitials` de `lib/chat.ts` — reutilizar, no duplicar) + nombre + botón "Comunicarte".
- "Comunicarte" → `router.push('/chat?userid=' + professor.id)` y cierra el modal (`onClose()`).
- Escape / click en backdrop cierra el modal, igual que `ComingSoonModal`.

## Frontend: header de `/materia/[slug]`

En `app/materia/[slug]/page.tsx`, dentro del bloque del header (línea ~478-502), se agrega debajo del `<h1>`/contador de secciones una fila con el botón, alineada a la derecha:

```tsx
<div className="flex items-end justify-between gap-3">
  <div>{/* label "Materia" + h1 + contador de secciones, como ya está */}</div>
  <button onClick={() => setContactOpen(true)} className="shrink-0 ...">
    Contactar Profesor
  </button>
</div>
```

Estilo del botón: píldora `rounded-full`, fondo `--surface2` o accent claro, ícono de mensaje (`lucide-react`, coherente con el ícono `MessageCircle` que ya usa `/chat`), texto `Contactar Profesor`. Solo se muestra cuando `courseName` ya cargó (no durante el skeleton de loading).

Estado nuevo: `const [contactOpen, setContactOpen] = useState(false)`. Se renderiza `<ContactProfessorModal courseId={parseInt(id)} open={contactOpen} onClose={() => setContactOpen(false)} />` al final del componente.

## Frontend: `/chat` — abrir conversación desde `?userid=`

En `app/chat/page.tsx`:

- Se lee el query param con `useSearchParams()` (`next/navigation`).
- Nuevo `useEffect` (corre después de que `authed` y `conversations` estén listos, para poder decidir si ya existe la conversación):
  ```ts
  useEffect(() => {
    const uid = Number(searchParams.get("userid"));
    if (!authed || !uid || convLoading) return;
    const existing = conversations.find((c) => c.contact.id === uid);
    if (existing) {
      setSelectedId(existing.id);
    } else {
      // arma un pendingContact con lo que ya tenemos del perfil (mismo shape
      // que usa openPendingContact al buscar en el buscador de chat)
      fetch(`/api/userprofile?userid=${uid}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => {
          if (p) setPendingContact({ id: uid, name: p.name, avatarUrl: null });
        });
    }
    router.replace("/chat");
  }, [authed, convLoading, conversations, searchParams]);
  ```
- `router.replace("/chat")` limpia el query param para que un refresh no vuelva a disparar la apertura ni interfiera con la navegación normal del chat.
- Si `/api/userprofile` falla o no hay nombre, no se abre nada (no rompe la página) — caso borde poco probable ya que el `userid` viene de la lista de profesores recién obtenida.
- `avatarUrl: null` es aceptable: `Avatar` ya cae a iniciales cuando no hay foto real, y una vez que el usuario mande el primer mensaje la conversación real (con foto) reemplaza al `pendingContact`.

## Testing

No hay suite de tests en el proyecto (ver `CLAUDE.md`). Verificación manual:
1. Entrar a una materia con profesores reales, tocar "Contactar Profesor", confirmar que la lista solo muestra profesores (no estudiantes) con foto/iniciales correctas.
2. Tocar "Comunicarte" en un profesor sin conversación previa → debe abrir `/chat` con el panel de chat activo en modo "Nuevo chat", mandar un mensaje y confirmar que se crea la conversación.
3. Repetir con un profesor con el que ya existe conversación → debe abrir esa conversación directamente (no una nueva).
4. Modo invitado: el modal debe mostrar "sin profesores" (o vacío) sin romper nada.
