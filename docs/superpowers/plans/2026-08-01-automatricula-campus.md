# Auto-matriculación al campus virtual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a student enrols in a materia on Sysacad, automatically enrol them in the matching Moodle (campus virtual) course using the enrolment key Sysacad returns — with a new "Campus" tab on `/sysacad/inscripcion` that shows their career's course catalog and lets them enrol by hand when the automatic path can't identify the course.

**Architecture:** Two new server routes scrape and drive Moodle with the user's existing `moodle_session_token` cookie: one reads the category tree + course listings to build a career-scoped catalog, the other drives Moodle's standard self-enrolment form (GET the form, harvest its hidden inputs, POST them back with the key). Pure name-matching helpers live in `lib/campus.ts` so both the auto-enrol chain and the UI share one definition of "these two names are the same materia". The page grows a segmented control that swaps the existing Sysacad sections for a new `CampusView`.

**Tech Stack:** Next.js App Router (Node runtime), TypeScript, SWR, Tailwind CSS v4 (iOS HIG styling: inline hex + CSS vars), lucide-react. Scraping is regex-based, matching the pattern already used by `app/api/course/route.ts` — no HTML parser dependency is added.

## Global Constraints

- No test suite exists in this repo (stated in `CLAUDE.md`) — do not add one. Verify with `npx tsc --noEmit`, `npm run lint`, `npm run build`, and the `curl` checks each task specifies.
- Colors are inline hex literals or `var(--…)` tokens in JSX, never Tailwind palette tokens (`bg-blue-500` etc.).
- Dark mode uses the `dark:` variant with arbitrary values (class strategy, `.dark` on `<html>`).
- Guest mode: reads return mock data; writes must never reach the real service — the client calls `triggerGuestBlock()` and the server returns 403 as defence in depth.
- Moodle base URL is `https://frsfco.cvg.utn.edu.ar`; the session cookie is sent as `Cookie: MoodleSession=<moodle_session_token>`.
- `@/*` maps to the project root.
- Never guess a course match. `matchearCurso` returns a course only when exactly one candidate matches; 0 or 2+ means the materia stays pending for manual enrolment.

---

### Task 1: `lib/campus.ts` — types and pure helpers

**Files:**
- Create: `lib/campus.ts`

**Interfaces:**
- Produces: `CampusCurso`, `CampusGrupo`, `CampusCatalogo`, `MatricularResult`, and functions `normalizarNombre`, `extraerAnio`, `matchearCurso`, `parseCheckSum`, `decodeEntities`, `stripTags`. Consumed by Tasks 2, 3, 4, 5, 7, 8.

- [ ] **Step 1: Write the file**

```ts
/**
 * Campus virtual (Moodle) — tipos y helpers puros compartidos entre el scraping
 * del servidor y la UI. Todo lo de acá es sincrónico y sin dependencias, para
 * que sirva igual en el route handler y en el cliente.
 */

/** Un curso del catálogo de Moodle. */
export interface CampusCurso {
  /** data-courseid del coursebox — mismo id que MoodleCourse.id, en string. */
  id: string;
  nombre: string;
  /** El curso acepta auto-matriculación con clave (ícono fa-key). */
  autoMatriculacion: boolean;
}

/** Un grupo del catálogo: una categoría de Moodle con sus cursos. */
export interface CampusGrupo {
  categoriaId: string;
  titulo: string;
  cursos: CampusCurso[];
}

/** Respuesta de GET /api/campus/catalogo. */
export interface CampusCatalogo {
  /** Nombre de la categoría de carrera que se pudo resolver, o null. */
  carrera: string | null;
  grupos: CampusGrupo[];
}

/** Respuesta de POST /api/campus/matricular. */
export type MatricularResult =
  | { ok: true; yaMatriculado?: boolean }
  | { ok: false; motivo: string };

// ─── HTML ─────────────────────────────────────────────────────────────────────

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

// ─── Nombres ──────────────────────────────────────────────────────────────────

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Extrae un año de 4 dígitos (20xx) del texto, si lo hay. */
export function extraerAnio(s: string): number | null {
  const m = (s ?? "").match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Normaliza un nombre de materia/curso para comparar Sysacad contra Moodle.
 *
 * Sysacad dice "Programación Web (Elec.)" y Moodle "Programación Web 2026";
 * para las básicas Moodle agrega la carrera: "Análisis Matemático I 2026 -
 * Ing. en Sistemas". El orden de los pasos importa: el sufijo de carrera se
 * saca ANTES que la puntuación, porque se detecta por el " - Ing." literal.
 */
export function normalizarNombre(s: string): string {
  let out = sinAcentos(s ?? "").toLowerCase();
  out = out.replace(/\(\s*elec\.?\s*\)/g, " ");   // "(Elec.)"
  out = out.replace(/\b20\d{2}\b/g, " ");         // año del ciclo
  out = out.replace(/\s-\s*ing\b[\s\S]*$/, " ");  // "- Ing. en Sistemas", "- Ing. Química …"
  out = out.replace(/[^a-z0-9\s]/g, " ");         // puntuación
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Busca el curso del campus que corresponde a una materia de Sysacad.
 *
 * Devuelve el curso SOLO si hay exactamente una coincidencia. Con 0 o 2+ la
 * materia queda pendiente para que el alumno la matricule a mano: adivinar
 * sería escribir en la cuenta de Moodle de alguien sobre una corazonada.
 *
 * Pasale `NombreMateriaLargo`, no `NombreMateria`: el web service trunca el
 * corto a 40 caracteres ("Sistemas de Apoyo a la Gestión y a las D").
 */
export function matchearCurso(
  nombreMateria: string,
  cursos: CampusCurso[],
  anio: number
): CampusCurso | null {
  const objetivo = normalizarNombre(nombreMateria);
  if (!objetivo) return null;
  const candidatos = cursos.filter((c) => {
    const anioCurso = extraerAnio(c.nombre);
    if (anioCurso !== null && anioCurso !== anio) return false;
    return normalizarNombre(c.nombre) === objetivo;
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * El CheckSum de Sysacad trae dos datos en líneas separadas:
 * "0V58ZF\nClave matriculación campus virtual = 5202340512026" — el código de
 * seguridad de la inscripción y la clave para auto-matricularse en Moodle.
 */
export function parseCheckSum(checkSum: string): { claveMatriculacion: string | null } {
  const claveLinea = (checkSum ?? "").split("\n").find((l) => /clave matriculaci/i.test(l));
  const clave = claveLinea?.split("=")[1]?.trim() ?? null;
  return { claveMatriculacion: clave || null };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Nothing imports the file yet.

- [ ] **Step 3: Sanity-check the matching rules**

The normalizer is the riskiest part of this plan, so verify it against real strings before anything depends on it. Compile the module on its own (only `tsc` is needed — do not assume `tsx` or `ts-node` are installed) and drive it from node:

```bash
npx tsc lib/campus.ts --outDir /tmp/campuscheck --module commonjs --target es2020 --skipLibCheck
node -e '
const { normalizarNombre, matchearCurso } = require("/tmp/campuscheck/campus.js");
const pares = [
  ["Simulación", "Simulación 2026", true],
  ["Programación Web (Elec.)", "Programación Web 2026", true],
  ["Análisis Matemático I", "Análisis Matemático I 2026 - Ing. en Sistemas", true],
  ["Análisis Matemático I", "Analisis Matematico I 2026- Ing. Electromecánica - Electrónica - Química", true],
  ["Economía", " Legislación 2026", false],
  ["Física II", "Física II - Cuatrimestral - 2026", false],
];
let fallos = 0;
for (const [m, c, esperado] of pares) {
  const ok = normalizarNombre(m) === normalizarNombre(c);
  if (ok !== esperado) fallos++;
  console.log(ok === esperado ? "OK  " : "FAIL", JSON.stringify(m), "vs", JSON.stringify(c), "->", ok);
}
const cursos = [
  { id: "1", nombre: "Física II - Anual - 2026", autoMatriculacion: true },
  { id: "2", nombre: "Física II - Cuatrimestral - 2026", autoMatriculacion: true },
];
const amb = matchearCurso("Física II", cursos, 2026);
if (amb !== null) fallos++;
console.log("ambiguo ->", amb);
console.log(fallos === 0 ? "TODO OK" : fallos + " FALLOS");
'
```

Expected: every row prints `OK`, the ambiguous case prints `null`, and the last line is `TODO OK`.

Two rows expect `false` on purpose. `Física II - Cuatrimestral - 2026` must **not** match bare `Física II`, because the same catalog also carries `Física II - Anual - 2026` — matching either would be a coin flip, so both stay pending for manual enrolment. If a row fails, fix `normalizarNombre` rather than loosening the expectation.

- [ ] **Step 4: Commit**

```bash
git add lib/campus.ts
git commit -m "feat(campus): add types and name-matching helpers"
```

---

### Task 2: Guest mock catalog

**Files:**
- Modify: `lib/guestMockData.ts`

**Interfaces:**
- Consumes: `CampusCatalogo` (Task 1).
- Produces: `MOCK_CAMPUS_CATALOGO` — consumed by Task 3.

- [ ] **Step 1: Extend the type import**

`lib/guestMockData.ts` already imports types from `@/lib/sysacadws`. Add a separate import for the campus type near it:

```ts
import type { CampusCatalogo } from "@/lib/campus";
```

- [ ] **Step 2: Append the mock**

Add at the end of the file. The ids are chosen so guest mode demonstrates all three states against the existing Sysacad mock (`MOCK_MATERIAS_PARA_CURSADO`) and the enrolled-course mock (`MOCK_COURSES`, ids 1001/1002/1003/1004):

- `Sistemas de Información 2026` → id `1001`, which **is** in `MOCK_COURSES` → renders as **Matriculada**.
- `Gestión de Proyectos 2026` → id `3002`, **not** in `MOCK_COURSES`, and its name matches Sysacad materia 4008 → renders as **Pendiente con match** (the "Matricularme" button).
- Seguridad Informática (Sysacad materia 4009) deliberately has **no** catalog entry → renders as **Pendiente sin match** (copy-the-key path).

```ts
// ─── Campus virtual (catálogo de matriculación) ───────────────────────────────

export const MOCK_CAMPUS_CATALOGO: CampusCatalogo = {
  carrera: "Ingeniería en Sistemas de Información",
  grupos: [
    {
      categoriaId: "43",
      titulo: "Nivel IV",
      cursos: [
        // id 1001 coincide con MOCK_COURSES -> ya matriculada
        { id: "1001", nombre: "Sistemas de Información 2026", autoMatriculacion: true },
        // sin equivalente en MOCK_COURSES -> pendiente, con match por nombre
        { id: "3002", nombre: "Gestión de Proyectos 2026", autoMatriculacion: true },
        { id: "3005", nombre: "Redes de Computadoras 2026", autoMatriculacion: true },
      ],
    },
    {
      categoriaId: "44",
      titulo: "Nivel V",
      cursos: [
        { id: "3010", nombre: "Auditoria de Sistemas 2026", autoMatriculacion: true },
        { id: "3011", nombre: "Calidad de Software 2026", autoMatriculacion: true },
        { id: "3012", nombre: "Proyecto Final 2026", autoMatriculacion: false },
      ],
    },
    {
      categoriaId: "205",
      titulo: "Materias básicas 2026",
      cursos: [
        { id: "2232", nombre: "Análisis Matemático I 2026 - Ing. en Sistemas", autoMatriculacion: true },
        { id: "2370", nombre: "Probabilidad y Estadística 2026", autoMatriculacion: true },
      ],
    },
  ],
};
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/guestMockData.ts
git commit -m "feat(campus): add guest mock catalog"
```

---

### Task 3: `GET /api/campus/catalogo`

**Files:**
- Create: `app/api/campus/catalogo/route.ts`

**Interfaces:**
- Consumes: `CampusCatalogo`, `CampusCurso`, `CampusGrupo`, `normalizarNombre`, `extraerAnio`, `stripTags` (Task 1); `MOCK_CAMPUS_CATALOGO` (Task 2); `isGuestRequest` (`lib/guest.ts`, existing).
- Produces: `GET /api/campus/catalogo?especialidad=<nombre>` → `CampusCatalogo` — consumed by Task 5.

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { isGuestRequest } from "@/lib/guest";
import { MOCK_CAMPUS_CATALOGO } from "@/lib/guestMockData";
import {
  extraerAnio,
  normalizarNombre,
  stripTags,
  type CampusCatalogo,
  type CampusCurso,
  type CampusGrupo,
} from "@/lib/campus";

export const runtime = "nodejs";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";
/** Los "Nivel N" acumulan los cursos de todos los ciclos; el default de 20 pagina. */
const PER_PAGE = 200;

interface CatNodo {
  id: string;
  nombre: string;
  depth: number;
}

/**
 * Parsea el árbol de categorías. Moodle lo renderiza anidado y en orden de
 * documento, con data-depth, así que la relación padre/hijo se reconstruye por
 * profundidad + posición (ver hijosDe).
 */
function parseCategorias(html: string): CatNodo[] {
  const out: CatNodo[] = [];
  const re =
    /data-categoryid="(\d+)"\s+data-depth="(\d+)"[\s\S]{0,400}?class="categoryname[^"]*"[\s\S]{0,200}?<a[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const nombre = stripTags(m[3]);
    if (nombre) out.push({ id: m[1], nombre, depth: Number(m[2]) });
  }
  return out;
}

/** Subcategorías directas de un nodo, según el orden de documento. */
function hijosDe(nodos: CatNodo[], idPadre: string): CatNodo[] {
  const i = nodos.findIndex((n) => n.id === idPadre);
  if (i === -1) return [];
  const base = nodos[i].depth;
  const hijos: CatNodo[] = [];
  for (let j = i + 1; j < nodos.length; j++) {
    if (nodos[j].depth <= base) break;
    if (nodos[j].depth === base + 1) hijos.push(nodos[j]);
  }
  return hijos;
}

/** Parsea los coursebox de una página de categoría. */
function parseCursos(html: string): CampusCurso[] {
  const out: CampusCurso[] = [];
  const re = /data-courseid="(\d+)"([\s\S]*?)(?=data-courseid="|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const bloque = m[2];
    const nombreRaw = bloque.match(/class="coursename"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1];
    if (!nombreRaw) continue;
    const nombre = stripTags(nombreRaw);
    if (!nombre) continue;
    out.push({
      id: m[1],
      nombre,
      autoMatriculacion: /fa-key|Auto-matricula/i.test(bloque),
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (isGuestRequest(req)) return NextResponse.json(MOCK_CAMPUS_CATALOGO);

  const token = req.cookies.get("moodle_session_token")?.value;
  if (!token) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const especialidad = req.nextUrl.searchParams.get("especialidad") ?? "";
  const cookie = `MoodleSession=${token}`;
  const anio = new Date().getFullYear();

  const traer = (url: string) =>
    fetch(url, { headers: { Cookie: cookie }, cache: "no-store" }).then((r) => r.text());

  try {
    // El árbol completo viene en la página de categorías. Si esa vista no lo
    // trae (depende de la config del sitio), el front page sí lo hace.
    let arbolHtml = await traer(`${MOODLE_BASE}/course/index.php`);
    let nodos = parseCategorias(arbolHtml);
    if (nodos.length === 0) {
      arbolHtml = await traer(`${MOODLE_BASE}/`);
      nodos = parseCategorias(arbolHtml);
    }

    const objetivo = normalizarNombre(especialidad);
    const carrera = objetivo
      ? nodos.find((n) => normalizarNombre(n.nombre) === objetivo)
      : undefined;

    // Categorías a listar: los "Nivel N" de la carrera + el ciclo corriente de
    // las materias básicas compartidas entre carreras.
    const aListar: CatNodo[] = carrera ? hijosDe(nodos, carrera.id) : [];

    const basicas = nodos.find((n) => /materias basicas/.test(normalizarNombre(n.nombre)));
    if (basicas) {
      const ciclo = hijosDe(nodos, basicas.id).find((c) => extraerAnio(c.nombre) === anio);
      if (ciclo) aListar.push({ ...ciclo, nombre: `Materias básicas ${anio}` });
    }

    const grupos: CampusGrupo[] = [];
    for (const cat of aListar) {
      const html = await traer(
        `${MOODLE_BASE}/course/index.php?categoryid=${cat.id}&perpage=${PER_PAGE}`
      );
      // Solo el ciclo corriente: los Nivel acumulan 2021-2026 y serían ~45 cada
      // uno. Los cursos sin año detectable se conservan, para no esconder una
      // materia que el alumno necesita.
      const cursos = parseCursos(html).filter((c) => {
        const a = extraerAnio(c.nombre);
        return a === null || a === anio;
      });
      if (cursos.length > 0) grupos.push({ categoriaId: cat.id, titulo: cat.nombre, cursos });
    }

    const catalogo: CampusCatalogo = { carrera: carrera?.nombre ?? null, grupos };
    return NextResponse.json(catalogo);
  } catch (err) {
    console.error("[campus-catalogo]", (err as Error).message);
    return NextResponse.json({ error: "No se pudo leer el catálogo del campus." }, { status: 502 });
  }
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, and no new lint findings in the created file. (The repo has pre-existing `react-hooks/set-state-in-effect` findings in other files — those are not yours.)

- [ ] **Step 3: Verify the parsers against the real captured HTML**

The captured pages are the only ground truth available without a live session, so exercise the two regexes against them. The parsers are module-private, so this check runs an inline copy of the exact same patterns — if you change a regex in the route, change it here too:

```bash
node -e '
const fs=require("fs");
const arbol=fs.readFileSync("harfiles/inscripcionmateriascampus/catalogodematerias.html","utf8");
const catRe=/data-categoryid="(\d+)"\s+data-depth="(\d+)"[\s\S]{0,400}?class="categoryname[^"]*"[\s\S]{0,200}?<a[^>]*>([\s\S]*?)<\/a>/g;
let m,n=0,isi=null;
while((m=catRe.exec(arbol))!==null){n++;const nom=m[3].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();if(/Sistemas de Informaci/.test(nom))isi={id:m[1],depth:m[2],nom};}
console.log("categorias parseadas:",n," ISI:",isi);
const cat=fs.readFileSync("harfiles/inscripcionmateriascampus/catalogomateriasciclo2026ejemplo.php","utf8");
const cRe=/data-courseid="(\d+)"([\s\S]*?)(?=data-courseid="|$)/g;let c,cursos=[];
while((c=cRe.exec(cat))!==null){const nm=c[2].match(/class="coursename"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);if(nm)cursos.push([c[1],nm[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(),/fa-key/.test(c[2])]);}
console.log("cursos parseados:",cursos.length);console.log(cursos.slice(0,3));
'
```

Expected: ~70 categories parsed with ISI found at depth 2, and **12** courses parsed from the 2026 cycle page, each with `true` for the key icon. If the counts are 0, the regex drifted from the fixture — fix it before moving on.

- [ ] **Step 4: Verify guest mode over HTTP**

Start the dev server in the background, then:

```bash
curl -s -H "Cookie: campus_guest=1" "http://localhost:3000/api/campus/catalogo?especialidad=Ingenier%C3%ADa%20en%20Sistemas%20de%20Informaci%C3%B3n" | head -c 400
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/campus/catalogo"
```

Expected: the first returns the mock catalog JSON (`"carrera":"Ingeniería en Sistemas de Información"`), the second returns `401` (no session, not guest). Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add app/api/campus/catalogo/route.ts
git commit -m "feat(campus): add career-scoped catalog scraping route"
```

---

### Task 4: `POST /api/campus/matricular`

**Files:**
- Create: `app/api/campus/matricular/route.ts`

**Interfaces:**
- Consumes: `decodeEntities`, `stripTags`, `MatricularResult` (Task 1); `isGuestRequest` (existing).
- Produces: `POST /api/campus/matricular` with body `{ courseId, clave }` → `MatricularResult` — consumed by Task 5.

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { isGuestRequest } from "@/lib/guest";
import { decodeEntities, stripTags } from "@/lib/campus";

export const runtime = "nodejs";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

/** El <form> de la página de matriculación que pide la clave. */
function formConClave(html: string): string | null {
  const forms = html.match(/<form[\s\S]*?<\/form>/gi) ?? [];
  return forms.find((f) => /name="enrolpassword"/i.test(f)) ?? null;
}

/**
 * Reenvía TODOS los ocultos del formulario tal cual vinieron. No alcanza con
 * mandar la clave: `instance` (la instancia de matriculación) es distinta en
 * cada curso, y `sesskey` cambia por sesión.
 */
function camposOcultos(form: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /<input[^>]*type="hidden"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(form)) !== null) {
    const name = m[0].match(/name="([^"]*)"/)?.[1];
    if (!name) continue;
    out.push([name, decodeEntities(m[0].match(/value="([^"]*)"/)?.[1] ?? "")]);
  }
  return out;
}

function botonSubmit(form: string): [string, string] | null {
  const tag = form.match(/<input[^>]*type="submit"[^>]*>/i)?.[0];
  const name = tag?.match(/name="([^"]*)"/)?.[1];
  if (!name) return null;
  return [name, decodeEntities(tag?.match(/value="([^"]*)"/)?.[1] ?? "")];
}

function mensajeDeError(html: string): string | null {
  const alerta = html.match(/class="[^"]*alert-danger[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const texto = alerta ? stripTags(alerta) : "";
  if (texto) return texto;
  const campo = html.match(
    /class="[^"]*(?:form-control-feedback|invalid-feedback|error)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i
  )?.[1];
  const t2 = campo ? stripTags(campo) : "";
  return t2 || null;
}

const esRedirA = (res: Response, patron: RegExp) =>
  res.status >= 300 && res.status < 400 && patron.test(res.headers.get("location") ?? "");

export async function POST(req: NextRequest) {
  if (isGuestRequest(req)) {
    return NextResponse.json({ error: "No disponible en modo invitado." }, { status: 403 });
  }

  const token = req.cookies.get("moodle_session_token")?.value;
  if (!token) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const { courseId, clave } = (await req.json().catch(() => ({}))) as {
    courseId?: string;
    clave?: string;
  };
  if (!/^\d+$/.test(String(courseId ?? ""))) {
    return NextResponse.json({ error: "Curso inválido." }, { status: 400 });
  }
  if (!clave) return NextResponse.json({ error: "Falta la clave." }, { status: 400 });

  const cookie = `MoodleSession=${token}`;
  const comun = { headers: { Cookie: cookie }, redirect: "manual" as const, cache: "no-store" as const };

  try {
    // 1. Traer el formulario. Si ya está matriculado, Moodle manda al curso.
    const getRes = await fetch(`${MOODLE_BASE}/enrol/index.php?id=${courseId}`, comun);
    if (esRedirA(getRes, /course\/view\.php/)) {
      return NextResponse.json({ ok: true, yaMatriculado: true });
    }

    const form = formConClave(await getRes.text());
    if (!form) {
      return NextResponse.json({
        ok: false,
        motivo: "El curso no acepta auto-matriculación con clave.",
      });
    }

    // 2. Reenviar los ocultos + la clave.
    const body = new URLSearchParams();
    for (const [n, v] of camposOcultos(form)) body.set(n, v);
    const submit = botonSubmit(form);
    if (submit) body.set(submit[0], submit[1]);
    body.set("enrolpassword", clave);

    const postRes = await fetch(`${MOODLE_BASE}/enrol/index.php`, {
      ...comun,
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (esRedirA(postRes, /course\/view\.php/)) return NextResponse.json({ ok: true });

    const motivo = mensajeDeError(await postRes.text()) ?? "La clave no fue aceptada.";
    return NextResponse.json({ ok: false, motivo });
  } catch (err) {
    console.error("[campus-matricular]", (err as Error).message);
    return NextResponse.json({ ok: false, motivo: "No se pudo conectar con el campus." });
  }
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new findings in the created file.

- [ ] **Step 3: Verify guest blocking and validation over HTTP**

With the dev server running:

```bash
curl -s -o /dev/null -w "guest=%{http_code}\n" -X POST -H "Cookie: campus_guest=1" \
  -H "Content-Type: application/json" -d '{"courseId":"2421","clave":"x"}' \
  http://localhost:3000/api/campus/matricular
curl -s -o /dev/null -w "anon=%{http_code}\n" -X POST \
  -H "Content-Type: application/json" -d '{"courseId":"2421","clave":"x"}' \
  http://localhost:3000/api/campus/matricular
```

Expected: `guest=403` and `anon=401`. Stop the dev server when done.

**Do not attempt a real enrolment** — that writes to the user's actual Moodle account. The live path is verified by the user during their own smoke test.

- [ ] **Step 4: Commit**

```bash
git add app/api/campus/matricular/route.ts
git commit -m "feat(campus): add self-enrolment route driving Moodle's enrol form"
```

---

### Task 5: `lib/campusHooks.ts`

**Files:**
- Create: `lib/campusHooks.ts`

**Interfaces:**
- Consumes: `CampusCatalogo`, `MatricularResult` (Task 1).
- Produces: `useCampusCatalogo(especialidad?: string)` (SWR, returns `{ data, error, isLoading }`) and `postMatricular(courseId: string, clave: string): Promise<MatricularResult>` — consumed by Tasks 7 and 8.

- [ ] **Step 1: Write the file**

Mirror the conventions already in `lib/sysacadHooks.ts`: same SWR config shape, and mutations that never reject.

```ts
"use client";

import useSWR from "swr";
import type { CampusCatalogo, MatricularResult } from "@/lib/campus";

const SWR_CFG = {
  revalidateOnFocus: false,
  dedupingInterval: 5 * 60_000,
  keepPreviousData: true,
} as const;

async function jsonOk<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const e = new Error("fetch failed") as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return r.json() as Promise<T>;
}

/** Clave SWR del catálogo — exportada para poder revalidarlo tras matricular. */
export function campusCatalogoKey(especialidad?: string): string | null {
  return especialidad
    ? `/api/campus/catalogo?especialidad=${encodeURIComponent(especialidad)}`
    : null;
}

export function useCampusCatalogo(especialidad?: string) {
  return useSWR<CampusCatalogo>(campusCatalogoKey(especialidad), jsonOk, SWR_CFG);
}

/** Matricula al alumno en un curso del campus. Nunca lanza. */
export async function postMatricular(courseId: string, clave: string): Promise<MatricularResult> {
  try {
    const r = await fetch("/api/campus/matricular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, clave }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, motivo: j.error ?? "No se pudo matricular en el campus." };
    return j as MatricularResult;
  } catch {
    return { ok: false, motivo: "No se pudo conectar. Revisá tu conexión." };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/campusHooks.ts
git commit -m "feat(campus): add catalog hook and matricular mutation"
```

---

### Task 6: `SegmentedControl` and `EstadoSincronizacion` components

**Files:**
- Create: `components/campus/SegmentedControl.tsx`
- Create: `components/campus/EstadoSincronizacion.tsx`

**Interfaces:**
- Produces: two default exports — `SegmentedControl({ options, value, onChange })` and `EstadoSincronizacion({ sysacad, campus })` — consumed by Tasks 7 and 8.

- [ ] **Step 1: Write `components/campus/SegmentedControl.tsx`**

```tsx
"use client";

/** Segmented control estilo iOS: una píldora que se mueve entre opciones. */
export default function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-1 rounded-full bg-[var(--surface2)] p-1"
    >
      {options.map((o) => {
        const activo = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={activo}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
              activo
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-sm"
                : "text-[var(--secondary)] hover:text-[var(--fg)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write `components/campus/EstadoSincronizacion.tsx`**

```tsx
"use client";

function Punto({ on }: { on: boolean }) {
  return on ? (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34c759]" />
  ) : (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-[var(--secondary)]" />
  );
}

/**
 * Estado de la materia en los dos sistemas que tienen que coincidir.
 * Inscribirse en Sysacad no matricula en el campus, así que de un vistazo
 * muestra qué falta: "Sysacad ● · Campus ○".
 */
export default function EstadoSincronizacion({
  sysacad,
  campus,
}: {
  sysacad: boolean;
  campus: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-medium text-[var(--secondary)]">
      <span className="inline-flex items-center gap-1">
        <Punto on={sysacad} />
        Sysacad
      </span>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        <Punto on={campus} />
        Campus
      </span>
    </span>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. Neither component is imported yet, so this only proves they compile.

- [ ] **Step 4: Commit**

```bash
git add components/campus/SegmentedControl.tsx components/campus/EstadoSincronizacion.tsx
git commit -m "feat(campus): add segmented control and sync-state chip"
```

---

### Task 7: `CampusView` component

**Files:**
- Create: `components/campus/CampusView.tsx`

**Interfaces:**
- Consumes: `CampusCatalogo`, `CampusCurso`, `matchearCurso`, `parseCheckSum` (Task 1); `postMatricular` (Task 5); `EstadoSincronizacion` (Task 6); `CollapsibleCard` (`components/sysacadws/CollapsibleCard.tsx`, existing); `SysacadMateriaParaCursado` (`lib/sysacadws.ts`, existing); `isGuestMode`, `triggerGuestBlock` (`lib/guest.ts`, existing).
- Produces: default export
  `CampusView({ inscriptas, catalogo, loading, idsMatriculados, onMatriculado })`:
  - `inscriptas: SysacadMateriaParaCursado[]` — materias enrolled in Sysacad
  - `catalogo: CampusCatalogo | undefined`
  - `loading: boolean`
  - `idsMatriculados: Set<string>` — Moodle course ids the student is already in
  - `onMatriculado: () => void` — called after a successful enrolment so the page can revalidate
  Consumed by Task 8.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Check, Copy, GraduationCap, KeyRound } from "lucide-react";
import CollapsibleCard from "@/components/sysacadws/CollapsibleCard";
import EstadoSincronizacion from "@/components/campus/EstadoSincronizacion";
import { matchearCurso, parseCheckSum, type CampusCatalogo, type CampusCurso } from "@/lib/campus";
import { postMatricular } from "@/lib/campusHooks";
import { isGuestMode, triggerGuestBlock } from "@/lib/guest";
import type { SysacadMateriaParaCursado } from "@/lib/sysacadws";

/** Botón de copiar al portapapeles con confirmación efímera. */
function CopiarClave({ clave }: { clave: string }) {
  const [copiada, setCopiada] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(clave);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      // Portapapeles no disponible: sin acción.
    }
  }
  return (
    <button
      type="button"
      onClick={copiar}
      className="flex items-center justify-center gap-1.5 rounded-xl border border-[#5ac8fa4d] px-3 py-2 text-[12px] font-semibold text-[#0a91c9] transition-colors hover:bg-[#5ac8fa1a] active:bg-[#5ac8fa26] dark:text-[#5ac8fa]"
    >
      {copiada ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copiada ? "Copiada" : `Copiar clave (${clave})`}
    </button>
  );
}

/** Fila del catálogo: se despliega para pegar la clave y matricularse. */
function FilaCurso({
  curso,
  matriculado,
  onMatricular,
}: {
  curso: CampusCurso;
  matriculado: boolean;
  onMatricular: (curso: CampusCurso, clave: string) => Promise<void>;
}) {
  const [abierta, setAbierta] = useState(false);
  const [clave, setClave] = useState("");
  const [ocupado, setOcupado] = useState(false);

  if (matriculado) {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--fg)]">{curso.nombre}</span>
        <span className="shrink-0 rounded-full bg-[#34c7591a] px-2.5 py-1 text-[11px] font-semibold text-[#34c759]">
          Matriculado
        </span>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        disabled={!curso.autoMatriculacion}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface2)] active:bg-[var(--surface2)] disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--fg)]">{curso.nombre}</span>
        {curso.autoMatriculacion ? (
          <KeyRound className="h-3.5 w-3.5 shrink-0 text-[var(--secondary)]" />
        ) : (
          <span className="shrink-0 text-[11px] text-[var(--secondary)]">Sin clave</span>
        )}
      </button>

      {abierta && curso.autoMatriculacion && (
        <div className="flex gap-2 px-4 pb-3">
          <input
            type="text"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder="Clave de matriculación"
            className="login-input min-w-0 flex-1 rounded-xl border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--fg)] outline-none placeholder:text-[var(--secondary)]"
          />
          <button
            type="button"
            disabled={!clave.trim() || ocupado}
            onClick={async () => {
              setOcupado(true);
              try {
                await onMatricular(curso, clave.trim());
              } finally {
                setOcupado(false);
              }
            }}
            className="shrink-0 rounded-xl border border-[#007aff33] px-3 py-2 text-[12px] font-semibold text-[#007aff] transition-colors hover:bg-[#007aff1a] active:bg-[#007aff26] disabled:opacity-40"
          >
            {ocupado ? "…" : "Matricularme"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function CampusView({
  inscriptas,
  catalogo,
  loading,
  idsMatriculados,
  onMatriculado,
}: {
  inscriptas: SysacadMateriaParaCursado[];
  catalogo: CampusCatalogo | undefined;
  loading: boolean;
  idsMatriculados: Set<string>;
  onMatriculado: () => void;
}) {
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);

  const anio = new Date().getFullYear();
  const todosLosCursos = useMemo(
    () => (catalogo?.grupos ?? []).flatMap((g) => g.cursos),
    [catalogo]
  );

  // Cada materia de Sysacad, con el curso del campus que le corresponde (si se
  // pudo identificar) y si ya está matriculada.
  const filas = useMemo(
    () =>
      inscriptas.map((m) => {
        const curso = matchearCurso(m.NombreMateriaLargo || m.NombreMateria, todosLosCursos, anio);
        return {
          materia: m,
          curso,
          clave: parseCheckSum(m.CheckSum ?? "").claveMatriculacion,
          matriculada: curso ? idsMatriculados.has(curso.id) : false,
        };
      }),
    [inscriptas, todosLosCursos, idsMatriculados, anio]
  );

  const pendientes = filas.filter((f) => !f.matriculada);
  const matriculadas = filas.filter((f) => f.matriculada);

  async function matricular(curso: CampusCurso, clave: string) {
    if (isGuestMode()) {
      triggerGuestBlock();
      return;
    }
    setAviso(null);
    setOcupada(curso.id);
    try {
      const r = await postMatricular(curso.id, clave);
      if (r.ok) {
        setAviso({ tono: "ok", texto: `Te matriculaste en ${curso.nombre}.` });
        onMatriculado();
      } else {
        setAviso({ tono: "error", texto: r.motivo });
      }
    } finally {
      setOcupada(null);
    }
  }

  if (loading && !catalogo) {
    return <p className="py-8 text-center text-[14px] text-[var(--secondary)]">Cargando catálogo…</p>;
  }

  return (
    <div className="space-y-4">
      {aviso && (
        <div
          className={
            aviso.tono === "ok"
              ? "rounded-2xl border border-[#34c75933] bg-[#34c7590d] px-4 py-3 text-[13px] font-medium text-[#34c759]"
              : "rounded-2xl border border-[#ffcdd2] bg-[#fff2f2] px-4 py-3 text-[13px] font-medium text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]"
          }
        >
          {aviso.texto}
        </div>
      )}

      {pendientes.length > 0 && (
        <section>
          <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
            Pendientes de matrícula
          </p>
          <div className="space-y-2.5">
            {pendientes.map(({ materia, curso, clave }) => (
              <div
                key={materia.IdMateria}
                className="rounded-2xl border border-[var(--separator)] px-4 py-3.5"
              >
                <p className="text-[15px] font-semibold text-[var(--fg)]">{materia.NombreMateria}</p>
                <div className="mt-1">
                  <EstadoSincronizacion sysacad campus={false} />
                </div>
                {!clave ? (
                  <p className="mt-2 text-[12px] text-[var(--secondary)]">
                    Sysacad no devolvió la clave de matriculación de esta materia.
                  </p>
                ) : curso ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={ocupada === curso.id}
                      onClick={() => matricular(curso, clave)}
                      className="flex-1 rounded-xl border border-[#007aff33] px-3 py-2 text-[12px] font-semibold text-[#007aff] transition-colors hover:bg-[#007aff1a] active:bg-[#007aff26] disabled:opacity-40"
                    >
                      {ocupada === curso.id ? "Matriculando…" : "Matricularme"}
                    </button>
                    <CopiarClave clave={clave} />
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <p className="text-[12px] text-[var(--secondary)]">
                      No pude identificar el curso en el campus. Buscalo en el catálogo de abajo y
                      pegá la clave.
                    </p>
                    <CopiarClave clave={clave} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {matriculadas.length > 0 && (
        <section>
          <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
            Matriculadas
          </p>
          <div className="space-y-2.5">
            {matriculadas.map(({ materia }) => (
              <div
                key={materia.IdMateria}
                className="rounded-2xl border border-[#34c75933] bg-[#34c7590d] px-4 py-3.5"
              >
                <p className="text-[15px] font-semibold text-[var(--fg)]">{materia.NombreMateria}</p>
                <div className="mt-1">
                  <EstadoSincronizacion sysacad campus />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {catalogo && catalogo.grupos.length === 0 && (
        <div className="rounded-2xl border border-[var(--separator)] px-4 py-6 text-center">
          <GraduationCap className="mx-auto h-6 w-6 text-[var(--secondary)]" />
          <p className="mt-2 text-[14px] text-[var(--secondary)]">
            {catalogo.carrera
              ? "No hay cursos del ciclo actual en el catálogo de tu carrera."
              : "No encontré tu carrera en el campus. Podés matricularte desde el campus virtual pegando la clave."}
          </p>
        </div>
      )}

      {(catalogo?.grupos ?? []).map((g) => (
        <CollapsibleCard key={g.categoriaId} title={g.titulo} icon={GraduationCap} iconColor="#007aff">
          <div className="divide-y divide-[var(--separator)] overflow-hidden rounded-2xl border border-[var(--separator)]">
            {g.cursos.map((c) => (
              <FilaCurso
                key={c.id}
                curso={c}
                matriculado={idsMatriculados.has(c.id)}
                onMatricular={matricular}
              />
            ))}
          </div>
        </CollapsibleCard>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no new findings in the created file.

- [ ] **Step 3: Commit**

```bash
git add components/campus/CampusView.tsx
git commit -m "feat(campus): add Campus tab view with catalog and manual enrolment"
```

---

### Task 8: Wire the segmented control and the auto-enrol chain into the page

**Files:**
- Modify: `app/sysacad/inscripcion/page.tsx`
- Modify: `components/sysacadws/MateriaInscripcionItem.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 1, 5, 6, 7; plus `useCourses` (`lib/hooks.ts`, existing — returns `{ courses, loading, error, refetch }` where `courses: MoodleCourse[]` with numeric `id`).
- Produces: the finished feature.

- [ ] **Step 1: De-duplicate `parseCheckSum`**

`components/sysacadws/MateriaInscripcionItem.tsx` defines its own `parseCheckSum`. Task 1 moved that logic into `lib/campus.ts`. Delete the local copy and its doc comment from the component, and import it instead:

```ts
import { parseCheckSum } from "@/lib/campus";
```

Leave every other part of that component untouched — the call site (`parseCheckSum(materia.CheckSum)`) already matches the shared signature.

- [ ] **Step 2: Add the imports and view state to the page**

In `app/sysacad/inscripcion/page.tsx`, add to the imports:

```ts
import SegmentedControl from "@/components/campus/SegmentedControl";
import CampusView from "@/components/campus/CampusView";
import { useCampusCatalogo, postMatricular } from "@/lib/campusHooks";
import { matchearCurso, parseCheckSum } from "@/lib/campus";
import { useCourses } from "@/lib/hooks";
import type { SysacadMateriasParaCursado } from "@/lib/sysacadws";
```

Inside the component, next to the existing state:

```ts
  const [vista, setVista] = useState<"sysacad" | "campus">("sysacad");
```

And after the existing `useMateriasParaCursado` call:

```ts
  const { data: catalogo, isLoading: catalogoLoading } = useCampusCatalogo(user?.especialidad);
  const { courses, refetch: refetchCourses } = useCourses();
  const idsMatriculados = useMemo(
    () => new Set(courses.map((c) => String(c.id))),
    [courses]
  );
```

Add `useMemo` to the existing `react` import.

- [ ] **Step 3: Chain the campus enrolment onto `handleInscribir`**

Replace the existing `handleInscribir` body. The key ordering detail: Sysacad only returns the enrolment key **after** the enrolment succeeds, so the key has to be read from the revalidated list — and from `globalMutate`'s **return value**, because `data` in the closure is still the pre-mutation list at that point.

```ts
  async function handleInscribir(materia: SysacadMateriaParaCursado, comision: string) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
    if (!legajo) return;
    setBanner(null);

    const r = await postInscribir(legajo, materia, comision);
    if (!r.ok) {
      setBanner({ tone: "error", text: r.motivo });
      return;
    }

    // La clave de matriculación al campus recién existe después de inscribirse,
    // así que hay que releer la materia de la lista revalidada.
    const actualizado = materiasKey
      ? ((await globalMutate(materiasKey)) as SysacadMateriasParaCursado | undefined)
      : undefined;

    const conClave = (actualizado?.Materias ?? []).find((m) => m.IdMateria === materia.IdMateria);
    const clave = parseCheckSum(conClave?.CheckSum ?? "").claveMatriculacion;
    const curso = clave
      ? matchearCurso(
          materia.NombreMateriaLargo || materia.NombreMateria,
          (catalogo?.grupos ?? []).flatMap((g) => g.cursos),
          new Date().getFullYear()
        )
      : null;

    if (!clave || !curso) {
      setBanner({
        tone: "ok",
        text: `Te inscribiste a ${materia.NombreMateria} en Sysacad. Matriculate al campus desde la pestaña Campus.`,
      });
      return;
    }

    const rc = await postMatricular(curso.id, clave);
    if (rc.ok) {
      refetchCourses();
      setBanner({
        tone: "ok",
        text: `Te inscribiste a ${materia.NombreMateria} en Sysacad y en el campus.`,
      });
    } else {
      setBanner({
        tone: "error",
        text: `Te inscribiste a ${materia.NombreMateria} en Sysacad, pero la matrícula al campus falló: ${rc.motivo} Podés hacerla desde la pestaña Campus.`,
      });
    }
  }
```

Leave `handleDesinscribir` exactly as it is — unenrolling from Sysacad must not touch the campus.

- [ ] **Step 4: Render the segmented control and swap the views**

Inside the authenticated branch, immediately after the `{banner && …}` block, insert the control:

```tsx
            <SegmentedControl
              ariaLabel="Sistema de inscripción"
              value={vista}
              onChange={(v) => setVista(v as "sysacad" | "campus")}
              options={[
                { value: "sysacad", label: "Sysacad" },
                { value: "campus", label: "Campus" },
              ]}
            />
```

Then wrap the four existing blocks — the `isLoading` message, the `error` message, the empty state, and the three `<section>`s (Inscripto / Podés inscribirte / Bloqueadas) — in `{vista === "sysacad" && ( … )}`, and add the campus branch after them:

```tsx
            {vista === "campus" && (
              <CampusView
                inscriptas={inscriptas}
                catalogo={catalogo}
                loading={catalogoLoading}
                idsMatriculados={idsMatriculados}
                onMatriculado={refetchCourses}
              />
            )}
```

Wrapping several adjacent JSX blocks in one conditional requires a fragment: use `{vista === "sysacad" && (<>…</>)}`.

- [ ] **Step 5: Type-check, lint and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass; `/sysacad/inscripcion` still appears in the route list. The only lint findings should be the repo's pre-existing `react-hooks/set-state-in-effect` ones.

- [ ] **Step 6: Verify in guest mode over HTTP**

With the dev server running:

```bash
curl -s -o /dev/null -w "page=%{http_code}\n" -H "Cookie: campus_guest=1" http://localhost:3000/sysacad/inscripcion
curl -s -H "Cookie: campus_guest=1" "http://localhost:3000/api/campus/catalogo?especialidad=Ingenier%C3%ADa%20en%20Sistemas%20de%20Informaci%C3%B3n" | head -c 200
```

Expected: `page=200` and the mock catalog JSON.

Full interactive verification (clicking the pill, expanding a catalog row, seeing the guest-block modal, dark mode) needs a browser. If no browser automation is available in your environment, say so plainly in your report rather than claiming it passed — the user does that pass themselves.

- [ ] **Step 7: Commit**

```bash
git add app/sysacad/inscripcion/page.tsx components/sysacadws/MateriaInscripcionItem.tsx
git commit -m "feat(campus): add Sysacad/Campus pill and auto-enrol on Sysacad inscription"
```

---

## Post-plan note

The live enrolment path cannot be exercised in this environment: a real `POST /enrol/index.php` writes to the student's actual Moodle account, and the captured HAR files recorded only XHR, so the enrolment form's exact markup was never observed. Tasks 3 and 4 are therefore written to read the form at runtime rather than assume field names, and their verification covers guest mode, auth/validation gates, and the parsers against the captured catalog fixtures.

What the user should check on their first real run, and report back if wrong:

1. Whether `GET /course/index.php` really carries the full category tree on this site (the fallback to `/` exists because only `/` was captured with the tree).
2. Whether a real self-enrolment succeeds, and whether Moodle's success redirect actually points at `/course/view.php` as assumed.
3. Whether any materia matches the wrong course. This is bounded: a wrong course rejects the key, so the failure mode is a failed enrolment and a red banner, not a silent enrolment in the wrong subject.
