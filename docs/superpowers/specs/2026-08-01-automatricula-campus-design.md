# Auto-matriculación al campus virtual — diseño

## Contexto

`/sysacad/inscripcion` ya permite inscribirse a cursado en Sysacad. Pero
inscribirse en Sysacad **no** matricula al alumno en el curso del campus
virtual (Moodle): hoy el alumno copia a mano la "clave de matriculación al
campus virtual" que devuelve Sysacad, entra al catálogo de cursos de Moodle,
busca la materia y pega la clave ahí.

Este diseño automatiza ese segundo paso y agrega una vista manual de respaldo:

1. Al inscribirse a una materia en Sysacad, la app intenta matricular al alumno
   en el curso correspondiente del campus, usando la clave que Sysacad acaba de
   devolver.
2. Una píldora (segmented control) arriba de las secciones alterna entre la
   vista **Sysacad** (la actual) y una vista **Campus** nueva, donde el alumno
   puede ver el catálogo de su carrera y matricularse a mano pegando la clave,
   por si el automatismo falla.

## Hallazgos sobre el campus (Moodle)

Confirmados contra las capturas en `harfiles/inscripcionmateriascampus/`.

### Árbol de categorías

Moodle **sí** clasifica los cursos por carrera. El árbol completo (ids, nombres
y cantidad de cursos) se renderiza en una sola página, por lo que no hace falta
hardcodear ids por carrera:

```
67  Carreras de Grado
├── 35  Materias básicas de Ingeniería      (compartidas entre carreras)
│   └── 205 Ciclo Lectivo 2026 · 196 Ciclo Lectivo 2025 · 179 Ciclo 2024 · …
├── 11  Ingeniería en Sistemas de Información
│   └── 40 Nivel I · 41 Nivel II · 42 Nivel III · 43 Nivel IV · 44 Nivel V
├── 26  Ingeniería Electromecánica          └── 50–54 Nivel I–V
├── 32  Ingeniería Electrónica              └── 55–59, 72 Nivel I–VI
├── 14  Ingeniería Química                  └── 45–49 Nivel I–V
├── 75  Ingeniería Industrial               └── 76, 77, 137, 154, 167
└── 33  Licenciatura en Administración Rural└── 60–63 Nivel I–IV
```

Marcado de cada nodo del árbol:

```html
<div class="category notloaded" data-categoryid="40" data-depth="3" ...>
  <div class="info">
    <h4 class="categoryname aabtn">
      <a href=".../course/index.php?categoryid=40">Nivel I</a>
      <span class="numberofcourse"> (45)</span>
    </h4>
  </div>
  <div class="content"><div class="subcategories">…anidado…</div></div>
</div>
```

El nombre de la categoría de carrera coincide **exactamente** con
`sysacadws_user.especialidad` (`"Ingeniería en Sistemas de Información"`), por
lo que la carrera del alumno se resuelve por coincidencia de nombre, sin tabla
de mapeo.

### Listado de cursos de una categoría

`GET /course/index.php?categoryid=N` devuelve:

```html
<div class="coursebox clearfix collapsed" data-courseid="2464" data-type="1">
  <div class="info">
    <div class="coursename">
      <a class="aalink" href=".../course/view.php?id=2464">Física II - Cuatrimestral - 2026</a>
    </div>
    <div class="moreinfo">…</div>
    <div class="enrolmenticons">
      <i class="fa fa-key" title="Auto-matriculación"></i>
    </div>
  </div>
</div>
```

- `data-courseid` → id del curso.
- `.coursename a` → nombre.
- `fa-key` / `title="Auto-matriculación"` en `.enrolmenticons` → el curso acepta
  auto-matriculación con clave.
- El listado **no** indica si el alumno ya está matriculado. Eso se cruza con
  los cursos que la app ya conoce vía `useCourses()`
  (`core_course_get_enrolled_courses_by_timeline_classification`), comparando
  por id de curso.
- Las categorías de Nivel tienen ~40–45 cursos (todos los ciclos mezclados,
  2021–2026), sobre el default de 20 por página de Moodle → hay que pedir
  `perpage` alto para no paginar.
- Codificación: UTF-8 (verificado a nivel bytes).

### Matriculación

Self-enrolment estándar de Moodle:

1. `GET /enrol/index.php?id={courseId}` → formulario con la clave.
2. `POST /enrol/index.php` con la clave y los campos ocultos del formulario.

Las capturas HAR solo registraron XHR, no las navegaciones, así que el
formulario exacto no está capturado. Por eso la implementación **scrapea todos
los `<input type="hidden">` del formulario en vivo y los reenvía tal cual**,
agregando solo `enrolpassword`. Esto no es una precaución opcional: el campo
`instance` (id de la instancia de matriculación) es distinto en cada curso y
hay que leerlo del formulario de todas formas.

Detección del resultado (con `redirect: "manual"`):

- `Location` hacia `/course/view.php?id=…` → matriculación exitosa.
- `200` con el formulario de nuevo → falló; el mensaje de error se extrae del
  HTML y se muestra al alumno.
- Si el alumno **ya** está matriculado, el `GET` inicial redirige directo al
  curso → se trata como éxito (ya está donde quiere estar).

## Decisiones acordadas con el usuario

| Tema | Decisión |
|---|---|
| Alcance del catálogo | Carrera del alumno (Niveles I–V) + Materias básicas del ciclo actual |
| Disparo | Automático al inscribirse en Sysacad, avisando en el banner si falla |
| Sin match confiable | No adivinar: la materia queda "pendiente" en la pestaña Campus |
| Baja en Sysacad | No toca el campus (no se pierde material ni entregas) |

### Filtro por ciclo (decisión de implementación)

Las categorías de Nivel acumulan los cursos de todos los ciclos (2021–2026),
~45 por nivel. Mostrar 220 cursos de seis años sería inusable, así que el
catálogo filtra por **ciclo académico corriente**: se detecta un año de 4
dígitos en el nombre del curso y se conservan los del año actual. Los cursos
sin año detectable **se incluyen** (mejor mostrar de más que esconder una
materia que el alumno necesita). El año corriente sale de `new Date()`.

## Cambios

### 1. `lib/campus.ts` (nuevo) — tipos y helpers puros

```ts
export interface CampusCurso {
  id: string;            // data-courseid
  nombre: string;
  autoMatriculacion: boolean;  // tiene fa-key
}

export interface CampusGrupo {
  categoriaId: string;
  titulo: string;        // "Nivel IV", "Materias básicas 2026"
  cursos: CampusCurso[];
}

export interface CampusCatalogo {
  carrera: string | null;   // nombre de la categoría de carrera resuelta
  grupos: CampusGrupo[];
}
```

Helper de normalización, compartido por el matcheo (server) y cualquier
filtrado en cliente:

```ts
/**
 * Normaliza un nombre de materia/curso para comparar entre Sysacad y Moodle:
 * minúsculas, sin acentos, sin año, sin sufijo de carrera, sin "(Elec.)",
 * sin puntuación, espacios colapsados.
 */
export function normalizarNombre(s: string): string;

/** Extrae un año de 4 dígitos (20xx) del nombre, si lo hay. */
export function extraerAnio(s: string): number | null;

/**
 * Busca el curso del campus que corresponde a una materia de Sysacad.
 * Devuelve el curso solo si hay UNA coincidencia; con 0 o 2+ devuelve null
 * (el usuario decidió no adivinar).
 */
export function matchearCurso(
  nombreMateria: string,
  cursos: CampusCurso[],
  anio: number
): CampusCurso | null;
```

Reglas de `normalizarNombre`, en orden: quitar acentos → minúsculas → quitar
`(elec.)` y variantes → quitar año `20xx` → quitar sufijos de carrera
(`- ing. en sistemas`, `- ing. electromecánica - electrónica - química`, …
detectados como ` - ing…` hasta el final) → quitar puntuación → colapsar
espacios → trim.

`matchearCurso` compara contra el nombre **largo** de la materia
(`NombreMateriaLargo`), porque `NombreMateria` viene truncado a 40 caracteres
en el web service (`"Sistemas de Apoyo a la Gestión y a las D"`).

### 2. `GET /api/campus/catalogo` (nuevo)

1. Lee la cookie `moodle_session_token`; sin ella → 401.
2. Lee `especialidad` del query string (la manda el cliente desde
   `sysacadws_user`, que es una cookie legible).
3. `GET /course/index.php` con la sesión → parsea el árbol de categorías
   (`data-categoryid` + `.categoryname a`). Si esa página no trae el árbol,
   reintenta con `/`.
4. Resuelve la categoría de la carrera comparando `normalizarNombre` del nombre
   de categoría contra la especialidad. Toma sus subcategorías (los "Nivel N").
5. Resuelve "Materias básicas de Ingeniería" y, dentro, la subcategoría cuyo
   nombre contenga el año corriente ("Ciclo Lectivo 2026").
6. Para cada categoría resultante: `GET /course/index.php?categoryid=N&perpage=200`
   → parsea los `coursebox`.
7. Filtra por ciclo corriente y devuelve `CampusCatalogo`.

Modo invitado: devuelve `MOCK_CAMPUS_CATALOGO` sin tocar Moodle.

### 3. `POST /api/campus/matricular` (nuevo)

Body: `{ courseId: string, clave: string }`.

1. Modo invitado → 403 `{ error: "No disponible en modo invitado." }`.
2. Sin cookie de sesión → 401. `courseId` no numérico → 400.
3. `GET /enrol/index.php?id={courseId}` con la sesión, `redirect: "manual"`.
   - Si redirige a `/course/view.php` → `{ ok: true, yaMatriculado: true }`.
4. Parsea el `<form>` que contiene un input `enrolpassword`; junta todos sus
   `<input type="hidden">` (name/value).
5. `POST /enrol/index.php` (`application/x-www-form-urlencoded`) con esos
   ocultos + `enrolpassword={clave}`, `redirect: "manual"`.
6. Resultado:
   - `Location` con `/course/view.php` → `{ ok: true }`.
   - Si no, extrae el texto de error del HTML devuelto y responde
     `{ ok: false, motivo }`. Motivo por defecto: "La clave no fue aceptada."

### 4. `lib/campusHooks.ts` (nuevo)

- `useCampusCatalogo(especialidad?: string)` — SWR sobre `/api/campus/catalogo`,
  misma config que los hooks de Sysacad.
- `postMatricular(courseId, clave): Promise<{ ok: true; yaMatriculado?: boolean } | { ok: false; motivo: string }>`
  — nunca lanza; los errores de red se devuelven como `{ ok: false }`, igual que
  las mutaciones de Sysacad.

### 5. `components/sysacadws/SegmentedControl.tsx` (nuevo)

Segmented control estilo iOS, genérico y reutilizable:

```ts
{ options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void; }
```

Contenedor `rounded-full bg-[var(--surface2)] p-1`, cada opción `flex-1`, la
activa con `bg-[var(--surface)] shadow-sm` y transición. Accesible con
`role="tablist"` / `role="tab"` y `aria-selected`.

### 6. `components/campus/EstadoSincronizacion.tsx` (nuevo)

El elemento distintivo del feature: un chip que muestra de un vistazo el estado
en los dos sistemas.

```
Sysacad ✓ · Campus ○
```

Props: `{ sysacad: boolean; campus: boolean }`. Punto lleno verde (`#34c759`)
cuando está, círculo vacío gris cuando falta. Es el modelo mental real del
problema — dos sistemas que tienen que coincidir — y no decoración.

### 7. `components/campus/CampusView.tsx` (nuevo)

La vista de la pestaña Campus. Recibe las materias inscriptas en Sysacad, el
catálogo y los cursos ya matriculados, y arma tres bloques:

1. **Pendientes de matrícula** — inscripto en Sysacad, no en el campus. Por
   materia: nombre, `EstadoSincronizacion`, botón "Matricularme" (usa el curso
   matcheado y la clave de Sysacad) y "Copiar clave". Si no hubo match, en vez
   del botón se muestra "Buscala en el catálogo" y la clave para copiar.
2. **Matriculadas** — inscripto en ambos. Solo nombre + `EstadoSincronizacion`.
3. **Catálogo** — un `CollapsibleCard` por grupo (Nivel I…V, Básicas). Cada
   curso es una fila; al tocarla se despliega un campo para pegar la clave y un
   botón "Matricularme". Los cursos ya matriculados muestran un chip
   "Matriculado" en vez del formulario.

Modo invitado: los botones de matricular llaman `triggerGuestBlock()`, igual
que el resto de las acciones de escritura de la app.

### 8. `app/sysacad/inscripcion/page.tsx` (modificar)

- Estado `vista: "sysacad" | "campus"`, con `SegmentedControl` arriba de las
  secciones (debajo del banner).
- `vista === "sysacad"` → las secciones actuales, sin cambios.
- `vista === "campus"` → `<CampusView />`.
- `handleInscribir` encadena la matriculación. La clave de matriculación **solo
  existe después** de inscribirse (Sysacad la devuelve recién entonces), así que
  el orden importa:
  1. `postInscribir` en Sysacad.
  2. `const actualizado = await globalMutate(materiasKey)` — se usa **el valor
     devuelto** por `globalMutate`, no el `data` del closure, que en ese punto
     todavía es el anterior.
  3. Buscar en `actualizado.Materias` la materia por `IdMateria` y leer su
     `CheckSum` → `parseCheckSum` → clave.
  4. `matchearCurso` contra el catálogo; si hay curso, `postMatricular`.

  El banner reporta el resultado combinado:
  - `Te inscribiste a {materia} en Sysacad y en el campus.`
  - `Te inscribiste a {materia} en Sysacad. La matrícula al campus falló — hacela desde la pestaña Campus.`
- `handleDesinscribir` no cambia (la baja no toca el campus).

La extracción de la clave desde `CheckSum` ya existe en
`MateriaInscripcionItem.tsx` (`parseCheckSum`); se mueve a `lib/campus.ts` para
que la use también la página, en vez de duplicarla.

### 9. `lib/guestMockData.ts` (modificar)

`MOCK_CAMPUS_CATALOGO`: dos grupos ("Nivel IV", "Materias básicas 2026") con
cursos cuyos nombres matcheen las materias del mock de Sysacad, para que el
modo invitado muestre los tres estados (pendiente con match, pendiente sin
match, ya matriculada).

## Fuera de alcance

- No se desmatricula del campus por ninguna vía (decisión del usuario).
- No se toca la vista Sysacad existente más allá de envolverla en la píldora.
- No se cachea el catálogo en servidor: SWR en cliente alcanza, y el catálogo
  cambia poco dentro de una sesión.
- No hay buscador de cursos: el catálogo ya viene acotado a la carrera del
  alumno y al ciclo corriente (una decena de materias por nivel), así que
  navegarlo alcanza. Si más adelante se muestra el catálogo completo, habrá que
  agregarlo.
- No se soportan carreras cuya categoría de Moodle no matchee por nombre con la
  especialidad de Sysacad: en ese caso el catálogo viene vacío y la vista Campus
  muestra un estado vacío explicando que no se encontró la carrera del alumno en
  el campus.
