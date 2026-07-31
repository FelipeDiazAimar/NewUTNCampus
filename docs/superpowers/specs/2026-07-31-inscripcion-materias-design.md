# Inscripción a materias (Sysacad) — diseño

## Contexto

Campus UTN ya integra el web service de Sysacad (`lib/sysacadws.ts`, proxy en
`app/api/sysacadws/[...path]/route.ts`) para mostrar avance, cursado, notas y
plan de estudios en `/sysacad`. El usuario capturó tráfico HTTP de la app
oficial de Sysacad que expone endpoints no usados todavía en este repo, para
listar materias disponibles a cursar, consultar comisiones y ejecutar
inscripción/desinscripción.

Este diseño agrega:
1. Un botón con estilo "aurora" debajo del card de KPIs (`ResumenHero`) en
   `/sysacad` que lleva a una nueva página.
2. La página `/sysacad/inscripcion`, que permite ver el estado de inscripción
   a cursado del cuatrimestre vigente e inscribirse/desinscribirse.

## Endpoints de Sysacad (confirmados por el usuario, capturados con Basic auth)

Todos bajo `https://sistemas.frsfco.utn.edu.ar/sysacadws`, autenticados con el
mismo header `Authorization: Basic base64(legajo:dni)` que ya usa el proxy
existente (cookie httpOnly `sysacadws_auth`).

- `GET /cursado/materiasparacursado/{legajo}` → `{ Estado, Materias: [...] }`
  Cada materia trae `Especialidad, Plan, IdMateria, NombreMateria,
  NombreMateriaLargo, Comision, Curso, Año, Horario, Edificio, CheckSum,
  DatoInscripción, EspecialidadHomogenea, PlanHomogenea, IdMateriaHomogenea,
  Condicional`.
  - `Comision !== "0"` → el alumno ya tiene una inscripción activa a esa
    materia, con horario/aula/checksum ya asignados.
  - `Comision === "0"` → la materia es candidata; falta decidir/consultar
    comisión.

- `GET /cursado/comisiones/{legajo}/{especialidad}/{plan}/{idMateria}` →
  `{ Estado, Comisiones: [{ Especialidad, Comision, Curso, Horario, Plan,
  Materia, Edificio, DatoInscripción, NombreEspecialidad }] }` — comisiones
  ofertadas para esa materia.
  - Responde **404** con `{ Message: "3 - No regularizó <correlativa>" }`
    cuando el alumno no cumple correlatividades. Se debe tratar como "materia
    bloqueada", no como error de red.

- `POST /cursado/inscribir/{legajo}/{especialidad}/{plan}/{idMateria}/{especialidadHomogenea}/{planHomogenea}/{idMateriaHomogenea}/{comision}`
  → body vacío, `Content-Type: application/x-www-form-urlencoded` →
  `{ Estado, HorarioCursado, Checksum, Edificio }` en éxito.

- `POST /cursado/desinscribir/{legajo}/{especialidad}/{plan}/{idMateria}/{especialidadHomogenea}/{planHomogenea}/{idMateriaHomogenea}/{comision}`
  → mismo shape de request, responde el string
  `"Se ha borrado exitosamente tu inscripción a cursado. "` (200, `text/plain`
  vía JSON string) en éxito.

Los 8 valores de `inscribir`/`desinscribir` salen directo de los campos del
objeto de materia (`Especialidad, Plan, IdMateria, EspecialidadHomogenea,
PlanHomogenea, IdMateriaHomogenea`) más `Comision` de la comisión elegida (o
la ya asignada, para desinscribir).

## Cambios

### 1. `lib/sysacadws.ts` — tipos nuevos

```ts
export interface SysacadMateriaParaCursado {
  Especialidad: string;
  Plan: string;
  IdMateria: string;
  NombreMateria: string;
  NombreMateriaLargo: string;
  Comision: string;
  Curso: string;
  Año: string;
  Horario: string;
  Edificio: string;
  CheckSum: string;
  DatoInscripción: string;
  EspecialidadHomogenea: string;
  PlanHomogenea: string;
  IdMateriaHomogenea: string;
  Condicional: string;
}
export interface SysacadMateriasParaCursado {
  Estado: string;
  Materias: SysacadMateriaParaCursado[];
}
export interface SysacadComisionDisponible {
  Especialidad: string;
  Comision: string;
  Curso: string;
  Horario: string;
  Plan: string;
  Materia: string;
  Edificio: string;
  DatoInscripción: string;
  NombreEspecialidad: string;
}
export interface SysacadComisionesDisponibles {
  Estado: string;
  Comisiones: SysacadComisionDisponible[];
}
export interface SysacadInscripcionResult {
  Estado: string;
  HorarioCursado: string;
  Checksum: string;
  Edificio: string;
}
```

### 2. Proxy `app/api/sysacadws/[...path]/route.ts`

- Agregar `export async function POST(...)` con la misma firma que `GET`:
  valida `isGuestRequest` (ver abajo), valida cookie `sysacadws_auth`, valida
  que todos los segmentos matcheen `/^[\w.@-]+$/`, reenvía a
  `${SYSACADWS_BASE}/${path.join("/")}` con método `POST`, header
  `Authorization: Basic ${auth}` y `Content-Type:
  application/x-www-form-urlencoded`, body vacío. Devuelve el body/status tal
  cual (mismo patrón que `GET`).
- Guest mode en `POST`: si `isGuestRequest(req)` y la ruta empieza con
  `cursado/inscribir/` o `cursado/desinscribir/`, devolver `403
  { error: "No disponible en modo invitado." }` sin llegar a Sysacad (defensa
  en profundidad; el bloqueo principal es en el cliente con
  `triggerGuestBlock()`).
- Guest mode en `GET`: agregar dos ramas más al `switch` existente:
  `cursado/materiasparacursado/` → `MOCK_MATERIAS_PARA_CURSADO`,
  `cursado/comisiones/` → `MOCK_COMISIONES` (mismo objeto sin importar los
  parámetros, es mock).

### 3. `lib/guestMockData.ts` — mocks nuevos

- `MOCK_MATERIAS_PARA_CURSADO: SysacadMateriasParaCursado` — 4-5 materias:
  2-3 ya inscriptas (`Comision: "1"`, con horario/aula/checksum) y 2-3
  candidatas (`Comision: "0"`), coherente con el resto del mock (Legajo
  12345, Plan 2008, ISI).
- `MOCK_COMISIONES: SysacadComisionesDisponibles` — 2 comisiones de ejemplo
  (para poder mostrar en el companion el flujo de selección con radios).

### 4. `lib/sysacadHooks.ts` — datos y mutaciones

- `useMateriasParaCursado(legajo)`: hook SWR (mismo `SWR_CFG` que el resto),
  `GET /api/sysacadws/cursado/materiasparacursado/{legajo}`.
- Funciones sueltas (no son hooks, se llaman desde el componente bajo
  demanda):
  - `fetchComisiones(legajo, especialidad, plan, idMateria): Promise<{ ok:
    true; comisiones: SysacadComisionDisponible[] } | { ok: false; motivo:
    string }>` — hace `GET` a `/api/sysacadws/cursado/comisiones/...`; en 404
    parsea `{ Message }` y lo devuelve como `motivo` (quita el prefijo `"3 -
    "` si está); en otro error no-2xx devuelve `motivo` genérico.
  - `postInscribir(materia: SysacadMateriaParaCursado, comision: string):
    Promise<{ ok: true; data: SysacadInscripcionResult } | { ok: false;
    motivo: string }>`.
  - `postDesinscribir(materia: SysacadMateriaParaCursado): Promise<{ ok:
    true } | { ok: false; motivo: string }>` — usa `materia.Comision` como
    comisión a dar de baja.
  - Ambas arman la URL de 8 segmentos con los campos de `materia`
    (`Especialidad, Plan, IdMateria, EspecialidadHomogenea, PlanHomogenea,
    IdMateriaHomogenea`) + comisión, hacen `POST` sin body.

### 5. Botón aurora en `/sysacad` (`app/sysacad/page.tsx`)

Debajo de `<ResumenHero />`, antes de `EgresoCard`, agregar:

```tsx
<Link
  href="/sysacad/inscripcion"
  className="relative flex items-center justify-center gap-2 overflow-hidden rounded-3xl px-5 py-4 shadow-sm
             bg-[linear-gradient(120deg,#007aff,#e6f0ff,#007aff)] dark:bg-[linear-gradient(120deg,#0a84ff,#05070d,#0a84ff)]
             bg-[length:200%_200%] animate-[aurora_6s_ease_infinite]"
>
  <CalendarCheck className="h-[18px] w-[18px] text-white drop-shadow" />
  <span className="text-[15px] font-semibold text-white drop-shadow">Inscripción a materias</span>
</Link>
```

- Ancho igual al card de KPIs (`w-full`, dentro del mismo `space-y-4` que ya
  usa `main`).
- Animación `aurora` (keyframes de `background-position`) definida una vez en
  `app/globals.css`, reutilizable a futuro.
- Mismo radio (`rounded-3xl`) y sombra que el resto de las cards de la
  página, para que se sienta parte del mismo sistema visual.

### 6. Página `app/sysacad/inscripcion/page.tsx`

Mismo esqueleto que `/sysacad`: `Navbar`, `Breadcrumb` (Dashboard → Sysacad →
Inscripción), gate de auth idéntico (cookie `moodle_user` + `SysacadWsLogin`
si falta `sysacadws_user` o la sesión de Sysacad expiró).

Cuerpo:
- `useMateriasParaCursado(legajo)`.
- Separar `Materias` en `inscriptas` (`Comision !== "0"`) y `disponibles`
  (`Comision === "0"`).
- Sección "Inscripto" (si `inscriptas.length > 0`): lista de
  `MateriaInscripcionItem` en modo "inscripta" (card verde, horario/aula,
  checksum, botón "Desinscribirme").
- Sección "Podés inscribirte": lista de `MateriaInscripcionItem` en modo
  "disponible" (ver componente).
- Estado vacío: si no hay materias en ninguna lista, texto "No hay materias
  para cursado en este momento.".
- Banner inline (no modal) arriba de la lista tras cada acción: verde en
  éxito ("Te inscribiste a {materia}."/"Te desinscribiste de {materia}."),
  rojo en error (mensaje de `motivo`). Se limpia al desmontar o iniciar una
  nueva acción.
- Tras éxito de inscribir/desinscribir: `mutate` de la key de
  `materiasparacursado` para refrescar la lista (la materia pasa de una
  sección a otra).

### 7. `components/sysacadws/MateriaInscripcionItem.tsx` (nuevo)

Encapsula una fila de materia con dos modos:

**Modo inscripta**: card con nombre, `Horario`, `Edificio`, línea de
`CheckSum` (clave matriculación campus virtual, si está), botón "Desinscribirme"
(rojo, estilo `text-[#ff3b30]`, mismo patrón que "Salir de Sysacad" en
`/sysacad`). Acción directa: al tocar, llama `postDesinscribir`, sin diálogo
de confirmación (según lo acordado).

**Modo disponible**: fila tocable (`CircleDot`/chevron) que al expandirse
dispara `fetchComisiones` (una vez, cachea el resultado en estado local del
componente):
- Mientras carga: skeleton corto.
- Si `motivo` (bloqueada): chip "Bloqueada" + texto del motivo, sin acción.
- Si 1 comisión: la muestra (horario/aula) + botón "Inscribirme" que llama
  `postInscribir` directo con esa comisión (auto-selección, sin radio).
- Si 2+ comisiones: radios con horario/aula por opción; botón "Inscribirme"
  deshabilitado hasta elegir una, luego acción directa (sin modal).

Ambos modos reciben callbacks `onSuccess(mensaje)` / `onError(mensaje)` que la
página usa para el banner, y no manejan el guest-mode ellos mismos — lo
resuelve la página envolviendo los callbacks de acción con el chequeo
`isGuestMode()` + `triggerGuestBlock()` antes de invocar `postInscribir` /
`postDesinscribir` (mismo patrón que `ForoClient.tsx`).

## Fuera de alcance

- No se toca `/dashboard/sysacad` (cambio de contraseña) ni otros widgets
  existentes de `/sysacad`.
- No se agrega período de inscripción (fechas de apertura/cierre): el botón
  aurora siempre es visible cuando el usuario está logueado en Sysacad; si no
  hay materias para cursar, la página muestra el estado vacío.
- No se persiste historial de inscripciones pasadas; solo el estado actual
  que devuelve Sysacad.
