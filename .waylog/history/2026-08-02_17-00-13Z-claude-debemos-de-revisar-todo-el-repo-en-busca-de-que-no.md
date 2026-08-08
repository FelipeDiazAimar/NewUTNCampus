# Debemos de revisar todo el repo en busca de que no
_Exported on 08/08/2026 at 13:31:17 GMT-3 from Claude via WayLog_


**User**

Debemos de revisar todo el repo en busca de que no queden expuestos endpoints o urls al cliente ni con f12 para que no se vean las llamadas al campus viejo ni nada, que el usuario no pueda extraer información de esa forma.Dame opciones para solucionar ello.
Por otro lado debemos de quitar cualquier referencia a un usuario en especifico o cosas harcodeadas para que esto sea realmente global e indistinto de cualquier user, y que pueda usarlo cualquier usuario de cualquier carrera y no haya problema. 
Preguntame lo que necesites.

---


**Claude**

Voy a revisar el código para entender qué se expone actualmente al cliente (URLs de Moodle, endpoints) y buscar cualquier dato hardcodeado de un usuario específico.

---


**Claude**

Con lo que encontré, esto es lo que hay que resolver. Te resumo los hallazgos antes de preguntarte nada:

**1. Endpoints/URLs expuestos al cliente (F12 → Network)**

Aunque ya existe un patrón de proxy (`/api/moodle`, `/api/sysacadws/...`), varias rutas devuelven o reciben la **URL real del campus viejo** en texto plano:
- [`app/api/course/route.ts`](app/api/course/route.ts) devuelve `fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/..."` en el JSON al cliente.
- El cliente después llama `/api/files?url=<esa URL real>` ([`app/api/files/route.ts`](app/api/files/route.ts)) — la URL completa de Moodle queda visible en la pestaña Network.
- Lo mismo pasa en `/api/meta`, `/api/convert`, `/api/resolve`, `/api/cvg/[...path]`.
- `SYSACADWS_BASE = "https://sistemas.frsfco.utn.edu.ar/sysacadws"` también podría filtrarse si algún componente arma URLs en cliente (a confirmar).

**Opciones para ocultar esto:**
- **A. Token opaco firmado (recomendada)** — el servidor cifra/firma la URL real en un token opaco (HMAC o AES-GCM con un secreto de servidor) y el cliente solo ve `/api/files?ref=xK9f...`. Sin estado, sin base de datos, cero cambio de infraestructura.
- **B. IDs internos de Moodle** — el cliente solo maneja `courseId`/`moduleId` (ya son solo números, no revelan dominio) y el servidor reconstruye la URL real en cada pedido re-consultando el curso. Más "limpio" pero más lento (relookup en cada descarga).
- **C. Combinar ambas** — IDs para navegación, token firmado solo para el caso de `fileurl` de `view.php` que no se puede derivar de un ID simple.

**2. Vulnerabilidad real encontrada (no solo exposición):** [`app/api/admin/login/route.ts`](app/api/admin/login/route.ts) tiene usuario/contraseña **hardcodeados en el código** (`admin` / `Admin123!`) y un token de sesión fijo (`campus-admin-2024-internal`) en una cookie **no-httpOnly** (legible por JS). Cualquiera que lea el repo tiene el login del panel admin para siempre.

**3. Referencias a un usuario/carrera específica:** revisé todo `lib/` y `app/` — la lógica real (no mock) ya normaliza nombres de carrera/materia de forma genérica ([`lib/campus.ts`](lib/campus.ts)) y no encontré hardcodeos de legajo/DNI/carrera reales fuera de los datos de **guest mode** (`lib/guestMockData.ts`, `lib/guest.ts`) que son intencionalmente ficticios. El único caso hardcodeado real y explotable es el panel admin del punto 2, y dos ramas de mock (`idMateria === "5008"/"5006"` en modo invitado, sin impacto real).

Antes de tocar código, necesito que definas prioridades:

---


**Claude**

Voy a chequear rápido `lib/cookies.ts` y `lib/crypto.ts` para confirmar el patrón existente y el maxAge antes de cerrar el plan.

---


**Claude**

Empiezo con la base: el módulo de tokens y consolidar `MOODLE_BASE`.

---


**Claude**

Ahora consolido `MOODLE_BASE` en las rutas restantes.

---


**Claude**

Como sospechaba, no se aplicó. Lo corrijo con Edit directamente.

---


**Claude**

Ahora tokenizo las rutas emisoras. Empiezo por `app/api/course/route.ts`.

---


**Claude**

Ahora agrego `finalizeModule` y lo aplico después de `resolveFilename`, y actualizo `sanitizeSummaryHtml`.

---


**Claude**

Ahora ubico el uso de `sanitizeSummaryHtml` y agrego el `rewriteMoodleHtml` allí.

---


**Claude**

Ahora agrego la llamada a `finalizeModule` en el handler `GET`, después del loop de `resolveFilename`.

---


**Claude**

Good, `fileurl?: string` optional — my code handles that correctly. Course/route.ts is done. Ahora actualizo `app/api/folder/route.ts` y `app/api/tareas/route.ts`.

---


**Claude**

Ahora el `downloadUrl`:

---


**Claude**

Ahora `app/api/tareas/route.ts` — tokenizo `TareaItem.url`.

---


**Claude**

Sigo con las rutas receptoras: `files`, `meta`, `convert`, `resolve`.

---


**Claude**

Ahora `app/api/convert/route.ts`:

---


**Claude**

Ahora `app/api/resolve/route.ts`:

---


**Claude**

Ahora los componentes cliente. Empiezo por `CourseFileViewer.tsx`.

---


**Claude**

Bien. Ahora actualizo `AssignmentViewer.tsx` para usar `?ref=` en todos los `/api/files` y `/api/assign`.

---


**Claude**

Ahora `CourseWorkspaceLayout.tsx`:

---


**Claude**

Ahora actualizo el cliente que arma ese FormData:

---


**Claude**

Ahora los demás `?url=` en este archivo (líneas 356, 626, 760, 832):

---


**Claude**

Ahora `UrlModuleRow`:

---


**Claude**

Ahora replico los mismos cambios en `app/materia/[slug]/page.tsx` (archivo casi idéntico).

---


**Claude**

Confirmado que es idéntico a `course/[id]/page.tsx`. Aplico los mismos parches.

---


**Claude**

Idéntico. Aplico los mismos tres parches.

---


**Claude**

Ahora `app/materias/[materiaId]/tareas/[tareaId]/page.tsx` y `app/tareas/page.tsx`:

---


**Claude**

Ahora actualizo el cliente de esta página para usar `id=` en vez de construir la URL:

---


**Claude**

Bien, limpio. Ahora reviso `H5pViewer.tsx` y `ContactDetailSheet.tsx` (aparecieron en el grep original) para confirmar que no necesitan cambios.

---


**Claude**

Ahora aplico esto en `/api/moodle/route.ts` y de paso limpio los console.log sensibles (Parte C, ya que estoy en este archivo).

---


**Claude**

Ahora aplico `rewriteMoodleUrlsDeep` al `data` antes de devolverlo:

---


**Claude**

Ahora simplifico `ContactDetailSheet.tsx` ya que el avatar ya llega proxeado desde `/api/moodle`.

---


**Claude**

Ahora un barrido final de referencias restantes al dominio real o a `?url=`.

---


**Claude**

This one doesn't leak the domain to the client (returns only parsed name/email/city fields), just consolidate the constant for consistency.

---


**Claude**

Fijo también el comentario en `CourseWorkspaceLayout.tsx`:

---


**Claude**

Ahora un último grep de todo el repo para confirmar que no quedan `?url=` hacia estas rutas.

---


**Claude**

Bien, todo limpio. Marco la tarea 6 completa y paso a la Parte B (admin auth).

---


**Claude**

Ahora actualizo `app/api/admin/login/route.ts` y `logout/route.ts`.

---


**Claude**

Ahora reemplazo los chequeos hardcodeados server-side. Primero los ubico todos.

---


**Claude**

lib/guest.ts is unrelated (different token). Let's fix each of the 5 real files.

---


**Claude**

Ahora los server components `app/admin/dashboard/page.tsx`, `app/admin/testnotis/page.tsx`, `app/foro/page.tsx`.

---


**Claude**

Ahora el lado cliente: `Navbar.tsx`, `app/asistencia/page.tsx`, `app/configuracion/page.tsx`, `app/admin/login/page.tsx`.

---


**Claude**

Todo limpio. Ahora la limpieza final de console.log sensibles (`lib/moodle.ts`, `app/api/auth/route.ts`).

---


**Claude**

Ahora `app/api/auth/route.ts`:

---


**Claude**

Ahora corro lint y build para verificar todo.

---


**Claude**

Los errores de lint son preexistentes (52 antes, 51 ahora — mi cambio no introdujo ninguno). Ahora corro el build para atrapar errores de TypeScript.

---


**Claude**

Build exitoso, sin errores de TypeScript. Marco las tareas finales como completas.

---


**Claude**

Todo limpio. Resumen de lo implementado:

---


**Claude**

## Resumen

**Build y lint verificados** — `npm run build` compila sin errores; los 51/52 problemas de lint son preexistentes (no introduje ninguno nuevo).

**Parte A — URLs del campus viejo ocultas:**
- `lib/urlToken.ts` (nuevo): cifra URLs reales de Moodle en tokens opacos AES-256-GCM, expiran a los 30 días.
- `lib/moodle.ts`: agregué `toProxyPath`, `rewriteMoodleHtml` y `rewriteMoodleUrlsDeep` — convierten cualquier URL/HTML/JSON real de Moodle en rutas `/api/cvg` o tokens antes de llegar al cliente.
- Rutas que emiten datos (`course`, `folder`, `tareas`, `calendar`, `courses`, `assign`) ahora tokenizan `fileurl`/`url` en vez de mandar el dominio real.
- Rutas que reciben (`files`, `meta`, `convert`, `resolve`, `assign`) ahora aceptan `?ref=` (token) en vez de `?url=` (URL cruda).
- `/api/moodle` (el proxy genérico de AJAX) reescribe recursivamente cualquier URL real que Moodle devuelva (avatares, perfiles, etc.) — esto también arregló un caso real de chat que se hubiera roto.
- Navegación a foros/quizzes/páginas de Moodle ahora se sirve 100% a través de `/api/cvg` (proxy autenticado que ya existía para H5P) — el usuario nunca sale del dominio propio.
- Saqué los `console.log` que imprimían la cookie de sesión completa y el sesskey en `/api/moodle`.

**Parte B — Panel admin:**
- `lib/adminAuth.ts` (nuevo): sesión firmada con HMAC (reutiliza `SESSION_SECRET`), reemplaza el usuario/contraseña/token hardcodeados.
- Cookie de sesión ahora es `httpOnly`; agregué `admin_ui` (no sensible) para que el cliente sepa si hay sesión admin sin exponer el token real.

**Acción pendiente de tu parte:** agregá `ADMIN_USER`, `ADMIN_PASS` y `SESSION_SECRET` a tu `.env.local` (y en Vercel) — no los inventé yo. Sin `ADMIN_USER`/`ADMIN_PASS` el login admin devuelve 500 a propósito; sin `SESSION_SECRET` todo corre con un secreto de desarrollo fijo, no seguro para producción.

---


**User**

Dame para copiar y pegar esas cosas en el .env y en vercel

---


**Claude**

Generé valores seguros y aleatorios. Guardalos ahora — no los vuelvo a mostrar.

**Para tu `.env.local`** (pegá esto al final del archivo):

```
SESSION_SECRET=79408527acb6083b93d94d05572de12646d774a052dec50a43583c35ea669b28
ADMIN_USER=admin
ADMIN_PASS=mdonUiu9XSlgW9ST
```

Cambiá `ADMIN_USER` si querés otro usuario; `ADMIN_PASS` es aleatoria fuerte, podés dejarla así.

**Para Vercel** (producción y preview), corré esto vos mismo desde la terminal — no lo voy a ejecutar por vos porque toca la config de un proyecto remoto:

```bash
vercel env add SESSION_SECRET production
vercel env add ADMIN_USER production
vercel env add ADMIN_PASS production

vercel env add SESSION_SECRET preview
vercel env add ADMIN_USER preview
vercel env add ADMIN_PASS preview
```

Cada comando te va a pedir pegar el valor interactivamente. Si preferís hacerlo desde el dashboard web (vercel.com → tu proyecto → Settings → Environment Variables), agregá las mismas tres claves con los mismos valores de arriba.

Importante: **usá el mismo `SESSION_SECRET` en local y en Vercel** — si difieren, las cookies de "recordar sesión" cifradas con uno no se van a poder leer con el otro (a los usuarios les pediría loguearse de nuevo, nada roto, pero conviene mantenerlo consistente entre entornos si vas a probar con datos migrados).

Después de cargarlos, reiniciá `npm run dev` (o hacé un redeploy en Vercel) para que tomen efecto.

---


**User**

Estas seguro de que ya nadie podra ver de donde sale la informacion ni nada referido al campus viejo ni a ningun user en especifico? Ademas tengo esta materia que tiene una seccion que dentro tiene una carpeta con archivos pero el desplegable no muestra nada pero desde el campus si se trae info: http://localhost:3000/materia/2423-programacion-web-2026
aca te dejo el html que veo desde el campus viejo @/c:/Users/Asus/Desktop/Facultad/IP-Calculator/Campus/campus-utn/harfiles/htmlejemplo/carpetaejemplo.html

---


**Claude**

Encontré la causa: cuando una carpeta de Moodle está configurada para mostrarse "en línea" en la página del curso (como esta, con el árbol de archivos embebido directamente en el HTML de la sección) en vez de "en página separada", el módulo no tiene un `<a href="...mod/folder/view.php?id=...">` — por eso mi parser no encuentra ninguna URL y el desplegable queda sin id para pedir el contenido. Es un bug preexistente del parser, no algo que rompí yo, pero lo arreglo ahora. Antes te respondo tu primera pregunta con honestidad.

---


**Claude**

Build OK. Ahora tu primera pregunta, con honestidad:

## ¿Estás 100% seguro de que nadie puede ver nada del campus viejo ni de ningún usuario?

No al 100%, y prefiero decírtelo claro en vez de venderte una garantía que no puedo sostener:

**Lo que sí cubrí y verifiqué:**
- Todas las rutas de curso/tareas/calendario/carpetas/foro que ya tenía identificadas ya no mandan `frsfco.cvg.utn.edu.ar` ni `sistemas.frsfco.utn.edu.ar` en texto plano al cliente — ni en el cuerpo de las respuestas JSON, ni en query params.
- El proxy genérico `/api/moodle` (usado por chat, notificaciones, y cualquier llamada AJAX a Moodle) ahora reescribe **cualquier** URL real que aparezca en la respuesta, no solo las que yo identifiqué a mano — esto cubre casos que no anticipé (como el avatar del chat, que de hecho se hubiera roto sin este fix).
- El panel admin ya no tiene credenciales ni token hardcodeados.
- Verifiqué con un grep final que no queda el dominio real en ningún archivo `.ts`/`.tsx` fuera de los puntos legítimos (los tres módulos que hablan con Moodle server-side, y los datos mock de invitado).

**Lo que NO puedo garantizar al 100%:**
1. **No hice un pentest real** — no abrí el DevTools yo mismo contra una sesión real de Moodle para confirmar visualmente cada pantalla. Hice el análisis por código, que es sólido pero no reemplaza probar la app real.
2. **Rutas que no exploré a fondo**: hay ~80 endpoints en el proyecto (biblioteca, telegram, notificaciones, sysacad, etc.) — me enfoqué en los que tocan Moodle/campus viejo directamente. Si alguno de los que no toqué también arma URLs de Moodle en algún lugar no obvio, podría quedar un caso suelto.
3. **Metadata de red que ninguna app puede ocultar**: si alguien mira tráfico a nivel de red (no DevTools, sino Wireshark/proxy) puede ver que tu servidor Next.js hace requests salientes a `frsfco.cvg.utn.edu.ar` — eso es inherente a que sos un proxy, no se puede esconder ahí. Lo que sí logré es que el **navegador del usuario final** nunca vea ni reciba esa información.
4. **Los "?ref=" son tokens cifrados pero de larga duración (30 días)** — no exponen la URL, pero si alguien copia el token y lo usa dentro de esos 30 días con una sesión de Moodle válida, funciona (es el trade-off que elegiste vos: comodidad vs. rotación corta).

Si querés más certeza real, lo próximo sería correr la skill `security-review` sobre la rama, o simplemente abrir la app en el navegador con DevTools abierto y navegar por todas las secciones mientras yo reviso el Network tab con vos.

---

## El bug de la carpeta

Ya lo arreglé. La causa: esa carpeta específica (id `146348`, "Teoria") está configurada en Moodle para mostrar el árbol de archivos **embebido directamente en la página del curso** (en vez de detrás de un link a una página aparte). Mi parser solo buscaba un `<a href="...mod/folder/view.php?...">` para saber el id de la carpeta — como no existe en este modo de visualización, no encontraba nada y el desplegable quedaba vacío.

El fix en [app/api/course/route.ts](app/api/course/route.ts): cuando un módulo es tipo `folder` y no hay `href`, reconstruyo la URL usando el cmid que ya tengo (`/mod/folder/view.php?id=146348`) — esa página existe siempre en Moodle sin importar el modo de visualización, así que el flujo existente de `/api/folder` funciona sin más cambios. Ya verifiqué que el build compila. Recargá `/materia/2423-programacion-web-2026` y debería mostrar los archivos ahora.

---


**User**

Esta carpeta está vacía. me pone

---


**Claude**

Ahora entiendo el alcance real: pasa en **todas** las carpetas porque Moodle, cuando una carpeta está configurada para mostrarse "en línea" (que parece ser la config por defecto de esta cátedra), hace que su página propia (`mod/folder/view.php`) simplemente redirija de vuelta al curso — por eso mi fetch secundario a esa página nunca encuentra el árbol correcto. Lo voy a arreglar de raíz: en vez de pedirle a Moodle una segunda página, extraigo el árbol de archivos directamente del HTML de la sección que ya tengo.

---


**Claude**

Primero creo el módulo compartido de parseo de árbol de carpetas.

---


**Claude**

Ahora actualizo `app/api/folder/route.ts` para reusar este módulo (sin cambiar su comportamiento):

---


**Claude**

Ahora agrego los campos nuevos a `MoodleModule` en `lib/moodle.ts`:

---


**Claude**

Ahora actualizo `app/api/course/route.ts` para extraer el árbol embebido cuando existe:

---


**Claude**

Ahora agrego la lógica de extracción del árbol embebido dentro de `parseModules`:

---


**Claude**

Ahora actualizo `FolderViewer.tsx` para usar el árbol embebido cuando está disponible, sin depender del fetch a `/api/folder`:

---


**Claude**

Build limpio. Recargá `/materia/2423-programacion-web-2026` y probá cualquier carpeta ahora — debería mostrar los archivos directamente al abrirse, sin depender de la página aparte de Moodle que redirigía en vacío.

**Resumen del fix real:** Moodle, cuando una carpeta está configurada como "mostrar en la página del curso" (que parece ser la config de esta cátedra para todas sus carpetas), hace que su página propia `mod/folder/view.php` simplemente redirija de vuelta al curso en lugar de mostrar el árbol — por eso mi segundo fetch nunca encontraba nada. Ahora extraigo el árbol directamente del HTML de la sección que ya cargo en `/api/course` (nuevo módulo compartido [lib/folderTree.ts](lib/folderTree.ts)), así que no depende de esa página frágil. Las carpetas con la config "página separada" (menos común) siguen funcionando con el fetch lazy de antes, sin cambios.

---


**User**

Esta carpeta está vacía.

si necesitas pone console logs temporales del paso a paso para saber porque no los trae o no es muestra.

---


**Claude**

Antes de que sigas: al correr `npm run build` para verificar detectó un error de TypeScript en `components/sysacadws/SysacadSwrProvider.tsx` — es un archivo que no toqué yo y no existía al empezar esta sesión, así que no lo voy a tocar (podría ser trabajo tuyo en curso). No bloquea el `npm run dev` que ya tenés corriendo, así que no afecta la prueba que necesitamos hacer ahora.

Ya agregué los console.log temporales en dos puntos:

1. **Servidor** ([app/api/course/route.ts](app/api/course/route.ts)): por cada módulo tipo carpeta, imprime el largo del HTML, si detectó `filemanager`, y si sí, el árbol de entradas parseado.
2. **Cliente** ([components/FolderViewer.tsx](components/FolderViewer.tsx)): imprime qué recibe `mod.folderEntries` al renderizar cada carpeta.

Para diagnosticar necesito que:
1. Recargues `/materia/2423-programacion-web-2026` (o la materia con la carpeta vacía).
2. Me pegues lo que aparece en la **terminal donde corre `npm run dev`** (busca líneas que empiecen con `[folder-debug]`).
3. Abras la consola del navegador (F12 → Console) y me pegues las líneas `[folder-debug client]`.

Con eso sé si el problema es que el servidor no está encontrando el árbol en el HTML (server-side) o si lo encuentra pero se pierde/no llega bien al componente (client-side).

---


**User**

No se que cambiaste o si relanzaste vos el codigo y eso actualizo los cambios pero ya quedo. Por otro lado quieor que cunado le de a previsualizar un archivo o cuando lo cierre o le de a dejar de previsualizar no me scrolle hasta arriba de las secciones de la materia sino que me deje en donde estaba el scroll, me explico: cuando scrolleo y busco una seccion hasta abajo en una materia y decido previsualizar un archivo se me habre en la columna de la derecha, dejando en la columna de la izquierda lo que estaba biendo, las secciones y sus archivos, quiero que en la columna de la izquierda no se vuelva hasta arriba sino que me deje el scroll donde estaba.

---


**Claude**

Bien, me alegra que haya quedado andando. Limpio los console.log temporales primero.

---


**Claude**

Ahora reviso `CourseWorkspaceLayout.tsx` para entender la estructura del split panel y por qué se resetea el scroll.

---


**Claude**

Entiendo el bug: cuando abrís un preview, la columna izquierda pasa de "scrollear con toda la página" a ser su propia caja con scroll interno (`overflowY: auto`) — ese cambio resetea el scroll a 0 aunque el contenido sea el mismo. Lo arreglo capturando la posición antes del cambio y restaurándola en el modo nuevo.

---


**Claude**

Ahora agrego el ref, la función de captura y el efecto, cerca de `panelRef`:

---


**Claude**

Ahora saco las declaraciones duplicadas más abajo y agrego `snapshotIndexScroll()` a `closePanel`:

---


**Claude**

Ahora agrego la captura en `closePanel`:

---


**Claude**

Ahora conecto el ref al div de la columna izquierda:

---


**Claude**

Bien, ambos casos (cerrar por toggle en el mismo archivo, y cerrar con la X del panel) pasan por el `closePanel` que ya actualicé. Ahora corro el build para verificar.

---


**Claude**

Build limpio (y de paso, ese error de TypeScript no relacionado en `SysacadSwrProvider.tsx` ya no aparece — probablemente lo arreglaste vos o lo tocó el mismo hook de antes).

## Resumen del fix de scroll

El problema: la columna izquierda (índice de secciones) cambia de "scrollear junto con toda la página" a "tener su propio scroll interno" apenas se abre un preview (para poder quedar fija en altura junto al panel derecho). Ese cambio de modo reseteaba la posición a 0 aunque el contenido no se hubiera movido.

En [components/CourseWorkspaceLayout.tsx](components/CourseWorkspaceLayout.tsx) agregué:
- Un `indexColumnRef` apuntando a esa columna.
- `snapshotIndexScroll()`: justo antes de abrir/cerrar un archivo o una tarea, mide en qué modo está la columna ahora mismo y guarda la posición equivalente para el modo al que va a pasar.
- Un `useLayoutEffect` que, apenas cambia `isPanelOpen`, aplica esa posición guardada (al div si pasa a scroll propio, a la ventana si vuelve a scroll normal) — antes de que el navegador pinte el cambio, así no se ve el salto.
- Lo enganché en los cuatro puntos donde se abre/cierra el panel: `openPanel`, `closePanel`, `openAssignment`, `closeAssignment`.

Recargá la página y probá: bajá hasta una sección, previsualizá un archivo, cerralo — debería quedarte en el mismo lugar en vez de saltar arriba.

---


**User**

Quitaste los console logs que agregamos temporalmente antess?

---


**Claude**

Sí, ya los saqué a los dos — el del servidor en [app/api/course/route.ts](app/api/course/route.ts) y el del cliente en [components/FolderViewer.tsx](components/FolderViewer.tsx). Verifiqué ahora con un grep de `folder-debug` en todo el repo y no queda ninguno.

---
