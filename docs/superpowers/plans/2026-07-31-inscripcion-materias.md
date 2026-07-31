# Inscripción a materias (Sysacad) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/sysacad/inscripcion` page where students can see which
materias they're already enrolled in for cursado, see which ones they can
still enroll in (with commission/schedule choice), and enroll/unenroll —
reached via a new "aurora" gradient button below the KPI card on `/sysacad`.

**Architecture:** Extend the existing Sysacad web-service integration
(`lib/sysacadws.ts` types, `lib/sysacadHooks.ts` SWR hooks, the generic proxy
at `app/api/sysacadws/[...path]/route.ts`) with three new upstream endpoints
(`materiasparacursado`, `comisiones`, `inscribir`/`desinscribir`). The proxy
already forwards `GET` with the student's stored Basic-auth cookie; this plan
adds a `POST` path through the same proxy for the two write endpoints. A new
page composes a new list-item component (`MateriaInscripcionItem`) per
materia, with a page-level guest-mode gate around the two mutations.

**Tech Stack:** Next.js App Router (Node runtime), TypeScript, SWR for data
fetching/caching, Tailwind CSS v4 (iOS HIG styling with inline hex + CSS
vars), lucide-react icons. No test framework is configured in this repo
(confirmed in `CLAUDE.md`) — verification steps in this plan use
`npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual browser
checks through the built-in guest mode instead of automated tests.

## Global Constraints

- No test suite exists in this repo — do not add one; verify with
  `tsc --noEmit`, `npm run lint`, `npm run build`, and manual guest-mode
  browser checks as specified per task.
- Colors are inline hex literals / `var(--...)` in JSX, never Tailwind color
  tokens (e.g. `text-blue-500`) — follow existing files' style exactly.
- Dark mode uses the `dark:` Tailwind variant with arbitrary values (class
  strategy via `.dark` on `<html>`), already confirmed in use across the
  repo (e.g. `app/asistencia/page.tsx`).
- All new API path segments sent to Sysacad must pass the existing
  `/^[\w.@-]+$/` per-segment validation already enforced by the proxy.
- Guest mode (`isGuestRequest` / `isGuestMode`) must never reach the real
  Sysacad WS for writes; mutations must call `triggerGuestBlock()` instead.
- `@/*` path alias maps to the project root.

---

### Task 1: Sysacad WS types for materiasparacursado / comisiones / inscripción

**Files:**
- Modify: `lib/sysacadws.ts` (insert after the `SysacadPlan` interface, i.e.
  after the closing `}` of the block ending at line 125, before the
  `SysacadWsUser` comment)

**Interfaces:**
- Produces: `SysacadMateriaParaCursado`, `SysacadMateriasParaCursado`,
  `SysacadComisionDisponible`, `SysacadComisionesDisponibles`,
  `SysacadInscripcionResult` — consumed by Tasks 2, 3, 4, 6, 7.

- [ ] **Step 1: Insert the new interfaces**

Open `lib/sysacadws.ts` and insert this block immediately after the
`SysacadPlan` interface (right before the `/** Datos del alumno que
guardamos...` comment that precedes `SysacadWsUser`):

```ts
/** Una materia candidata a cursar (/cursado/materiasparacursado/{legajo}). */
export interface SysacadMateriaParaCursado {
  Especialidad: string;
  Plan: string;
  IdMateria: string;
  NombreMateria: string;
  NombreMateriaLargo: string;
  Comision: string; // "0" = sin inscripción activa; cualquier otro valor = ya inscripto
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

/** /cursado/materiasparacursado/{legajo} */
export interface SysacadMateriasParaCursado {
  Estado: string;
  Materias: SysacadMateriaParaCursado[];
}

/** Una comisión ofertada para una materia. */
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

/** /cursado/comisiones/{legajo}/{especialidad}/{plan}/{idMateria} */
export interface SysacadComisionesDisponibles {
  Estado: string;
  Comisiones: SysacadComisionDisponible[];
}

/** Respuesta de POST /cursado/inscribir/... */
export interface SysacadInscripcionResult {
  Estado: string;
  HorarioCursado: string;
  Checksum: string;
  Edificio: string;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (the file only gained exported interfaces, nothing
consumes them yet).

- [ ] **Step 3: Commit**

```bash
git add lib/sysacadws.ts
git commit -m "feat(sysacad): add types for materiasparacursado/comisiones/inscripcion"
```

---

### Task 2: Guest-mode mock data for materiasparacursado / comisiones

**Files:**
- Modify: `lib/guestMockData.ts`

**Interfaces:**
- Consumes: `SysacadMateriasParaCursado`, `SysacadComisionesDisponibles`
  (Task 1).
- Produces: `MOCK_MATERIAS_PARA_CURSADO`, `MOCK_COMISIONES` — consumed by
  Task 3.

- [ ] **Step 1: Add the type imports**

In `lib/guestMockData.ts`, extend the existing import from `@/lib/sysacadws`:

```ts
import type {
  SysacadCursado,
  SysacadAvance,
  SysacadExamenes,
  SysacadPlan,
  SysacadMateriasParaCursado,
  SysacadComisionesDisponibles,
} from "@/lib/sysacadws";
```

- [ ] **Step 2: Append the mock constants**

Add this block at the end of the file, after `MOCK_CORRELATIVIDADES`. The
guest student (Legajo 12345, Plan 2008, `IdEspecialidad "2"`, ver
`GUEST_SYSACAD_USER` en `lib/guest.ts`) ya está cursando 3 materias anuales
(4007/4008/4009, igual que `MOCK_CURSADO`) y tiene 3 materias de 5º año como
candidatas: una con una sola comisión ofertada (auto-selección), una con dos
comisiones (selección con radio) y una bloqueada por correlatividades (mismo
motivo que `MOCK_CORRELATIVIDADES` usa para la materia 5008):

```ts
// ─── Materias para cursado (inscripción) ──────────────────────────────────────

export const MOCK_MATERIAS_PARA_CURSADO: SysacadMateriasParaCursado = {
  Estado: "OK",
  Materias: [
    {
      Especialidad: "2", Plan: "2008", IdMateria: "4007",
      NombreMateria: "Sistemas de Información", NombreMateriaLargo: "Sistemas de Información",
      Comision: "1", Curso: "4K", Año: "4",
      Horario: "Miércoles 21:30-23:45, Jueves 18:00-21:00",
      Edificio: "MODALIDAD PRESENCIAL aula 12",
      CheckSum: "AB12CD\nClave matriculación campus virtual = 520400712026",
      DatoInscripción: "Ya inscripto (Código de seguridad = AB12CD\nClave matriculación campus virtual = 520400712026)",
      EspecialidadHomogenea: "2", PlanHomogenea: "2008", IdMateriaHomogenea: "4007",
      Condicional: "false",
    },
    {
      Especialidad: "2", Plan: "2008", IdMateria: "4008",
      NombreMateria: "Gestión de Proyectos", NombreMateriaLargo: "Gestión de Proyectos",
      Comision: "1", Curso: "4K", Año: "4",
      Horario: "Martes 18:00-21:00, Jueves 21:30-23:45",
      Edificio: "MODALIDAD PRESENCIAL aula 8",
      CheckSum: "EF34GH\nClave matriculación campus virtual = 520400812026",
      DatoInscripción: "Ya inscripto (Código de seguridad = EF34GH\nClave matriculación campus virtual = 520400812026)",
      EspecialidadHomogenea: "2", PlanHomogenea: "2008", IdMateriaHomogenea: "4008",
      Condicional: "false",
    },
    {
      Especialidad: "2", Plan: "2008", IdMateria: "4009",
      NombreMateria: "Seguridad Informática", NombreMateriaLargo: "Seguridad Informática",
      Comision: "1", Curso: "4K", Año: "4",
      Horario: "Lunes 18:00-21:00, Miércoles 18:00-21:00",
      Edificio: "MODALIDAD PRESENCIAL Laboratorio 3",
      CheckSum: "IJ56KL\nClave matriculación campus virtual = 520400912026",
      DatoInscripción: "Ya inscripto (Código de seguridad = IJ56KL\nClave matriculación campus virtual = 520400912026)",
      EspecialidadHomogenea: "2", PlanHomogenea: "2008", IdMateriaHomogenea: "4009",
      Condicional: "false",
    },
    {
      Especialidad: "2", Plan: "2008", IdMateria: "5005",
      NombreMateria: "Auditoria de Sistemas", NombreMateriaLargo: "Auditoria de Sistemas",
      Comision: "0", Curso: "", Año: "5",
      Horario: "", Edificio: "", CheckSum: "", DatoInscripción: "",
      EspecialidadHomogenea: "0", PlanHomogenea: "0", IdMateriaHomogenea: "0",
      Condicional: "false",
    },
    {
      Especialidad: "2", Plan: "2008", IdMateria: "5006",
      NombreMateria: "Calidad de Software", NombreMateriaLargo: "Calidad de Software",
      Comision: "0", Curso: "", Año: "5",
      Horario: "", Edificio: "", CheckSum: "", DatoInscripción: "",
      EspecialidadHomogenea: "0", PlanHomogenea: "0", IdMateriaHomogenea: "0",
      Condicional: "false",
    },
    {
      Especialidad: "2", Plan: "2008", IdMateria: "5008",
      NombreMateria: "Sistemas de Información 2", NombreMateriaLargo: "Sistemas de Información 2",
      Comision: "0", Curso: "", Año: "5",
      Horario: "", Edificio: "", CheckSum: "", DatoInscripción: "",
      EspecialidadHomogenea: "0", PlanHomogenea: "0", IdMateriaHomogenea: "0",
      Condicional: "false",
    },
  ],
};

// El proxy en modo invitado devuelve siempre este mock sin mirar los
// parámetros de la URL — no hace falta discriminar por materia.
export const MOCK_COMISIONES: SysacadComisionesDisponibles = {
  Estado: "OK",
  Comisiones: [
    {
      Especialidad: "2", Comision: "1", Curso: "5K",
      Horario: "Viernes 18:00-22:30", Plan: "2008", Materia: "5005",
      Edificio: "MODALIDAD PRESENCIAL aula 4",
      DatoInscripción: "", NombreEspecialidad: "Ingeniería en Sistemas de Información",
    },
    {
      Especialidad: "2", Comision: "2", Curso: "5K Noche",
      Horario: "Sábado 08:00-12:30", Plan: "2008", Materia: "5005",
      Edificio: "MODALIDAD PRESENCIAL aula 6",
      DatoInscripción: "", NombreEspecialidad: "Ingeniería en Sistemas de Información",
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
git commit -m "feat(sysacad): add guest mock data for materia enrollment"
```

---

### Task 3: Proxy support for materiasparacursado / comisiones (GET) and inscribir/desinscribir (POST)

**Files:**
- Modify: `app/api/sysacadws/[...path]/route.ts`

**Interfaces:**
- Consumes: `MOCK_MATERIAS_PARA_CURSADO`, `MOCK_COMISIONES` (Task 2),
  `isGuestRequest` (`lib/guest.ts`, existing), `SYSACADWS_BASE`
  (`lib/sysacadws.ts`, existing).
- Produces: `POST` handler on the same route, reachable as
  `POST /api/sysacadws/cursado/inscribir/{...8 segments}` and
  `POST /api/sysacadws/cursado/desinscribir/{...8 segments}` — consumed by
  Task 4's `postInscribir`/`postDesinscribir`.

- [ ] **Step 1: Add the two new guest GET branches**

In `app/api/sysacadws/[...path]/route.ts`, update the import and the guest
`if` block inside `GET`:

```ts
import {
  MOCK_DATOS_PERSONALES,
  MOCK_CURSADO,
  MOCK_ESTADO_ACADEMICO,
  MOCK_AVANCE,
  MOCK_EXAMENES,
  MOCK_PLAN,
  MOCK_INASISTENCIAS,
  MOCK_CORRELATIVIDADES,
  MOCK_MATERIAS_PARA_CURSADO,
  MOCK_COMISIONES,
} from "@/lib/guestMockData";
```

```ts
  if (isGuestRequest(req)) {
    if (route.startsWith("cursado/datospersonales/"))       return NextResponse.json(MOCK_DATOS_PERSONALES);
    if (route.startsWith("cursado/coninasistencia/"))       return NextResponse.json(MOCK_CURSADO);
    if (route.startsWith("cursado/estadoacademico/"))       return NextResponse.json(MOCK_ESTADO_ACADEMICO);
    if (route.startsWith("cursado/materias/cantidadesporanio/")) return NextResponse.json(MOCK_AVANCE);
    if (route.startsWith("cursado/inasistencias/"))         return NextResponse.json(MOCK_INASISTENCIAS);
    if (route.startsWith("cursado/correlatividadcursado/")) return NextResponse.json(MOCK_CORRELATIVIDADES);
    if (route.startsWith("cursado/materiasparacursado/"))   return NextResponse.json(MOCK_MATERIAS_PARA_CURSADO);
    if (route.startsWith("cursado/comisiones/"))             return NextResponse.json(MOCK_COMISIONES);
    if (route.startsWith("examenes/"))                      return NextResponse.json(MOCK_EXAMENES);
    if (route.startsWith("plan/"))                          return NextResponse.json(MOCK_PLAN);
    return NextResponse.json({ Estado: "OK", data: [] });
  }
```

- [ ] **Step 2: Add the POST handler**

Append this function at the end of the file (after the existing `GET`
function):

```ts
/**
 * Igual que GET pero para las mutaciones de cursado (inscribir/desinscribir),
 * que en Sysacad son POST con body vacío x-www-form-urlencoded.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const route = (path ?? []).join("/");

  if (isGuestRequest(req)) {
    if (route.startsWith("cursado/inscribir/") || route.startsWith("cursado/desinscribir/")) {
      return NextResponse.json({ error: "No disponible en modo invitado." }, { status: 403 });
    }
    return NextResponse.json({ Estado: "OK" });
  }

  const auth = req.cookies.get("sysacadws_auth")?.value;
  if (!auth) {
    return NextResponse.json({ error: "No autenticado en Sysacad." }, { status: 401 });
  }
  if (!path?.length || path.some((seg) => !/^[\w.@-]+$/.test(seg))) {
    return NextResponse.json({ error: "Ruta inválida." }, { status: 400 });
  }

  const url = `${SYSACADWS_BASE}/${path.join("/")}${req.nextUrl.search}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      cache: "no-store",
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    console.error("[sysacadws-proxy]", (err as Error).message);
    return NextResponse.json({ error: "No se pudo conectar con Sysacad." }, { status: 502 });
  }
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification against guest mode**

Run: `npm run dev` (leave it running), then in another terminal:

```bash
curl -s -H "Cookie: campus_guest=1" http://localhost:3000/api/sysacadws/cursado/materiasparacursado/12345
curl -s -H "Cookie: campus_guest=1" http://localhost:3000/api/sysacadws/cursado/comisiones/12345/2/2008/5005
curl -s -X POST -H "Cookie: campus_guest=1" http://localhost:3000/api/sysacadws/cursado/inscribir/12345/2/2008/5005/2/2008/5005/1
```

Expected: first two return the mock JSON (`Materias`/`Comisiones` arrays);
the third returns `{"error":"No disponible en modo invitado."}` with a 403
status (check with `curl -i` if you want to confirm the status code).

Stop the dev server after checking (`Ctrl+C` in its terminal, or leave it
running if the next tasks will reuse it).

- [ ] **Step 5: Commit**

```bash
git add app/api/sysacadws/[...path]/route.ts
git commit -m "feat(sysacad): proxy POST for inscribir/desinscribir + guest GET mocks"
```

---

### Task 4: Data hook and mutation functions

**Files:**
- Modify: `lib/sysacadHooks.ts`

**Interfaces:**
- Consumes: `SysacadMateriasParaCursado`, `SysacadMateriaParaCursado`,
  `SysacadComisionDisponible`, `SysacadComisionesDisponibles`,
  `SysacadInscripcionResult` (Task 1).
- Produces:
  - `useMateriasParaCursado(legajo?: string)` — SWR hook, same shape as
    `useCursado`/`useAvance`.
  - `type ComisionesResult = { ok: true; comisiones: SysacadComisionDisponible[] } | { ok: false; motivo: string }`
  - `fetchComisiones(legajo: string, especialidad: string, plan: string, idMateria: string): Promise<ComisionesResult>`
  - `type AccionResult = { ok: true } | { ok: false; motivo: string }`
  - `postInscribir(legajo: string, materia: SysacadMateriaParaCursado, comision: string): Promise<{ ok: true; data: SysacadInscripcionResult } | { ok: false; motivo: string }>`
  - `postDesinscribir(legajo: string, materia: SysacadMateriaParaCursado): Promise<AccionResult>`
  These four are consumed by Task 7 (the page); the hook's SWR key
  (`` `/api/sysacadws/cursado/materiasparacursado/${legajo}` ``) is also
  needed there for `mutate()` after a successful action.

- [ ] **Step 1: Extend the type import**

At the top of `lib/sysacadHooks.ts`, extend the existing `import type` from
`@/lib/sysacadws`:

```ts
import type {
  SysacadAvance,
  SysacadCursado,
  SysacadCorrelatividades,
  SysacadEstadoAcademico,
  SysacadExamenes,
  SysacadPlan,
  SysacadMateriasParaCursado,
  SysacadMateriaParaCursado,
  SysacadComisionDisponible,
  SysacadComisionesDisponibles,
  SysacadInscripcionResult,
} from "@/lib/sysacadws";
```

- [ ] **Step 2: Add the SWR hook**

Add this next to the other `use*` hooks (e.g. right after `usePlan`):

```ts
export function useMateriasParaCursado(legajo?: string) {
  return useSWR<SysacadMateriasParaCursado>(
    legajo ? `/api/sysacadws/cursado/materiasparacursado/${legajo}` : null,
    jsonOk,
    SWR_CFG
  );
}
```

- [ ] **Step 3: Add the mutation helpers**

Add this at the end of the file:

```ts
// ─── Inscripción a cursado (mutaciones, no son hooks SWR) ─────────────────────

export type ComisionesResult =
  | { ok: true; comisiones: SysacadComisionDisponible[] }
  | { ok: false; motivo: string };

/** Consulta las comisiones ofertadas para una materia candidata. */
export async function fetchComisiones(
  legajo: string,
  especialidad: string,
  plan: string,
  idMateria: string
): Promise<ComisionesResult> {
  const r = await fetch(
    `/api/sysacadws/cursado/comisiones/${legajo}/${especialidad}/${plan}/${idMateria}`,
    { cache: "no-store" }
  );
  if (r.status === 404) {
    const j = await r.json().catch(() => ({ Message: "" }));
    const motivo = String(j.Message ?? "").replace(/^\d+\s*-\s*/, "").trim();
    return { ok: false, motivo: motivo || "No cumplís las correlatividades para esta materia." };
  }
  if (!r.ok) return { ok: false, motivo: "No se pudo consultar las comisiones disponibles." };
  const j = (await r.json()) as SysacadComisionesDisponibles;
  return { ok: true, comisiones: j.Comisiones ?? [] };
}

export type AccionResult = { ok: true } | { ok: false; motivo: string };

/**
 * Arma la URL de inscribir/desinscribir. El trío Especialidad/Plan/IdMateria
 * de la materia se repite dos veces (ver spec: los campos *Homogenea vienen
 * en "0" cuando Comision === "0" y no sirven para esta llamada).
 */
function inscripcionUrl(
  accion: "inscribir" | "desinscribir",
  legajo: string,
  materia: SysacadMateriaParaCursado,
  comision: string
): string {
  const { Especialidad, Plan, IdMateria } = materia;
  return `/api/sysacadws/cursado/${accion}/${legajo}/${Especialidad}/${Plan}/${IdMateria}/${Especialidad}/${Plan}/${IdMateria}/${comision}`;
}

export async function postInscribir(
  legajo: string,
  materia: SysacadMateriaParaCursado,
  comision: string
): Promise<{ ok: true; data: SysacadInscripcionResult } | { ok: false; motivo: string }> {
  const r = await fetch(inscripcionUrl("inscribir", legajo, materia, comision), { method: "POST" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, motivo: j.error ?? j.Message ?? "No se pudo completar la inscripción." };
  return { ok: true, data: j as SysacadInscripcionResult };
}

export async function postDesinscribir(
  legajo: string,
  materia: SysacadMateriaParaCursado
): Promise<AccionResult> {
  const r = await fetch(inscripcionUrl("desinscribir", legajo, materia, materia.Comision), { method: "POST" });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    return { ok: false, motivo: j.error ?? j.Message ?? "No se pudo completar la baja." };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification with the dev server (guest mode)**

With `npm run dev` running:

```bash
curl -s http://localhost:3000/api/sysacadws/cursado/materiasparacursado/12345 -H "Cookie: campus_guest=1"
```

This is the same URL `useMateriasParaCursado` builds — confirms the hook's
key format matches a real, working endpoint. No component consumes the hook
yet, so this is the only reachable check until Task 7.

- [ ] **Step 6: Commit**

```bash
git add lib/sysacadHooks.ts
git commit -m "feat(sysacad): add materiasparacursado hook and inscripcion mutations"
```

---

### Task 5: Aurora keyframes + entry button on /sysacad

**Files:**
- Modify: `app/globals.css` (add `@keyframes aurora`)
- Modify: `app/sysacad/page.tsx` (add the button below `ResumenHero`)

**Interfaces:**
- Consumes: nothing new (pure UI).
- Produces: a working link from `/sysacad` to `/sysacad/inscripcion` (Task 7
  creates the target page — until then this link 404s, which is expected and
  fine to leave for one commit since each task must be independently
  testable on its own terms: the button's rendering/style is what this task
  verifies).

- [ ] **Step 1: Add the aurora keyframes**

In `app/globals.css`, add this next to the other `@keyframes` blocks (e.g.
right after `today-ring`'s `}` on line 130):

```css
/* Botón "aurora" — entrada a inscripción de materias */
@keyframes aurora {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}
```

- [ ] **Step 2: Add the button to the Sysacad page**

In `app/sysacad/page.tsx`, add the `CalendarCheck` icon to the existing
`lucide-react` import:

```ts
import { ChevronRight, KeyRound, LogOut, CalendarCheck } from "lucide-react";
```

Then insert the button right after the `<ResumenHero .../>` element and
before `{!coreLoading && (`:

```tsx
            <ResumenHero
              loading={coreLoading || estadoLoading}
              estado={estado}
              examenes={examenes?.Examenes ?? []}
              plan={plan ?? null}
              avance={avance ?? null}
              cursado={cursado ?? null}
            />

            <Link
              href="/sysacad/inscripcion"
              className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-3xl px-5 py-4 shadow-sm
                         bg-[linear-gradient(120deg,#007aff,#e6f0ff,#007aff)] dark:bg-[linear-gradient(120deg,#0a84ff,#05070d,#0a84ff)]
                         bg-[length:200%_200%] animate-[aurora_6s_ease_infinite]"
            >
              <CalendarCheck className="h-[18px] w-[18px] text-white drop-shadow" />
              <span className="text-[15px] font-semibold text-white drop-shadow">Inscripción a materias</span>
            </Link>

            {!coreLoading && (
```

(`Link` is already imported at the top of this file.)

- [ ] **Step 3: Lint and type-check**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual visual check**

Run: `npm run dev`, open `http://localhost:3000` in a browser, set the
`campus_guest=1` cookie flow (use the app's own "Continuar como invitado"
entry point on the login page, or navigate to `/sysacad` after using it) and
navigate to `/sysacad`. Confirm:
- The button appears directly below the KPI card, full width, `rounded-3xl`,
  with a moving blue gradient.
- Toggle the OS/browser dark mode (or the app's theme toggle if present) and
  confirm the gradient switches to the blue→black variant with legible white
  text in both themes.
- Clicking the button navigates to `/sysacad/inscripcion` and shows a 404 (or
  the not-found page) — expected until Task 7 lands.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/sysacad/page.tsx
git commit -m "feat(sysacad): add aurora entry button to materia enrollment"
```

---

### Task 6: MateriaInscripcionItem component

**Files:**
- Create: `components/sysacadws/MateriaInscripcionItem.tsx`

**Interfaces:**
- Consumes: `SysacadMateriaParaCursado` (Task 1), `fetchComisiones`,
  `ComisionesResult` (Task 4).
- Produces: default export
  `MateriaInscripcionItem({ legajo, materia, mode, onInscribir, onDesinscribir })`
  — a React component, consumed by Task 7. Props:
  - `legajo: string`
  - `materia: SysacadMateriaParaCursado`
  - `mode: "inscripta" | "disponible"`
  - `onInscribir: (materia: SysacadMateriaParaCursado, comision: string) => Promise<void>`
  - `onDesinscribir: (materia: SysacadMateriaParaCursado) => Promise<void>`

  The component never calls `postInscribir`/`postDesinscribir` directly —
  the page injects those (wrapped with the guest-mode check, banner state,
  and SWR revalidation) via these two callbacks. The component's own state
  only covers UI concerns: expand/collapse, comisiones loading/result,
  selected radio, and a local `busy` flag to disable buttons mid-request.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, CircleDot, Lock, MapPin } from "lucide-react";
import type { SysacadMateriaParaCursado } from "@/lib/sysacadws";
import { fetchComisiones, type ComisionesResult } from "@/lib/sysacadHooks";

export default function MateriaInscripcionItem({
  legajo,
  materia,
  mode,
  onInscribir,
  onDesinscribir,
}: {
  legajo: string;
  materia: SysacadMateriaParaCursado;
  mode: "inscripta" | "disponible";
  onInscribir: (materia: SysacadMateriaParaCursado, comision: string) => Promise<void>;
  onDesinscribir: (materia: SysacadMateriaParaCursado) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loadingComisiones, setLoadingComisiones] = useState(false);
  const [result, setResult] = useState<ComisionesResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (mode !== "disponible") return;
    const next = !expanded;
    setExpanded(next);
    if (next && !result && !loadingComisiones) {
      setLoadingComisiones(true);
      const r = await fetchComisiones(legajo, materia.Especialidad, materia.Plan, materia.IdMateria);
      setLoadingComisiones(false);
      setResult(r);
      if (r.ok && r.comisiones.length === 1) setSelected(r.comisiones[0].Comision);
    }
  }

  async function handleInscribir() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await onInscribir(materia, selected);
    } finally {
      setBusy(false);
    }
  }

  async function handleDesinscribir() {
    if (busy) return;
    setBusy(true);
    try {
      await onDesinscribir(materia);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "inscripta") {
    return (
      <div className="rounded-2xl border border-[#34c75933] bg-[#34c7590d] px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[var(--fg)]">{materia.NombreMateria}</p>
            {materia.Horario && (
              <p className="mt-0.5 text-[12px] text-[var(--secondary)]">{materia.Horario}</p>
            )}
            {materia.Edificio && (
              <p className="mt-0.5 flex items-center gap-1 text-[12px] text-[var(--secondary)]">
                <MapPin className="h-3 w-3 shrink-0" />
                {materia.Edificio}
              </p>
            )}
            {materia.CheckSum && (
              <p className="mt-1 whitespace-pre-line text-[11px] leading-snug text-[var(--secondary)]">
                {materia.CheckSum}
              </p>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-[#34c7591a] px-2.5 py-1 text-[11px] font-semibold text-[#34c759]">
            Inscripto
          </span>
        </div>
        <button
          type="button"
          onClick={handleDesinscribir}
          disabled={busy}
          className="mt-3 w-full rounded-xl border border-[#ff3b3033] py-2 text-[13px] font-semibold text-[#ff3b30] active:opacity-70 disabled:opacity-50"
        >
          {busy ? "Procesando…" : "Desinscribirme"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--separator)]">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-[var(--surface2)]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#007aff1a]">
          <CircleDot className="h-4 w-4 text-[#007aff]" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--fg)]">{materia.NombreMateria}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--secondary)] transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-[var(--separator)] px-4 py-3.5">
          {loadingComisiones && (
            <p className="text-[13px] text-[var(--secondary)]">Consultando comisiones…</p>
          )}

          {!loadingComisiones && result && !result.ok && (
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#ff9500]" />
              <p className="text-[13px] leading-snug text-[var(--secondary)]">{result.motivo}</p>
            </div>
          )}

          {!loadingComisiones && result && result.ok && result.comisiones.length === 0 && (
            <p className="text-[13px] text-[var(--secondary)]">No hay comisiones ofertadas por el momento.</p>
          )}

          {!loadingComisiones && result && result.ok && result.comisiones.length > 0 && (
            <div className="space-y-3">
              {result.comisiones.length > 1 ? (
                <div className="space-y-2">
                  {result.comisiones.map((c) => (
                    <label
                      key={c.Comision}
                      className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--separator)] px-3 py-2.5"
                    >
                      <input
                        type="radio"
                        name={`comision-${materia.IdMateria}`}
                        checked={selected === c.Comision}
                        onChange={() => setSelected(c.Comision)}
                        className="mt-0.5 accent-[#007aff]"
                      />
                      <span className="text-[13px] text-[var(--fg)]">
                        <span className="font-medium">{c.Curso || `Comisión ${c.Comision}`}</span>
                        {c.Horario && <span className="block text-[12px] text-[var(--secondary)]">{c.Horario}</span>}
                        {c.Edificio && <span className="block text-[12px] text-[var(--secondary)]">{c.Edificio}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--separator)] px-3 py-2.5 text-[13px] text-[var(--fg)]">
                  <p className="font-medium">{result.comisiones[0].Curso || "Comisión única"}</p>
                  {result.comisiones[0].Horario && (
                    <p className="text-[12px] text-[var(--secondary)]">{result.comisiones[0].Horario}</p>
                  )}
                  {result.comisiones[0].Edificio && (
                    <p className="text-[12px] text-[var(--secondary)]">{result.comisiones[0].Edificio}</p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleInscribir}
                disabled={!selected || busy}
                className="w-full rounded-xl bg-[#007aff] py-2 text-[13px] font-semibold text-white active:opacity-80 disabled:opacity-40"
              >
                {busy ? "Procesando…" : "Inscribirme"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (The component isn't imported anywhere yet, so this only
checks the file compiles standalone — full behavior is verified in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add components/sysacadws/MateriaInscripcionItem.tsx
git commit -m "feat(sysacad): add MateriaInscripcionItem component"
```

---

### Task 7: /sysacad/inscripcion page

**Files:**
- Create: `app/sysacad/inscripcion/page.tsx`

**Interfaces:**
- Consumes: `useMateriasParaCursado`, `postInscribir`, `postDesinscribir`
  (Task 4), `MateriaInscripcionItem` (Task 6), `isGuestMode`,
  `triggerGuestBlock` (`lib/guest.ts`, existing), `Navbar`, `Breadcrumb`
  (existing shared components), `SysacadWsUser` (`lib/sysacadws.ts`,
  existing).
- Produces: the route `/sysacad/inscripcion`, the final destination of the
  aurora button added in Task 5.

- [ ] **Step 1: Write the page**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import SysacadWsLogin from "@/components/sysacadws/LoginForm";
import MateriaInscripcionItem from "@/components/sysacadws/MateriaInscripcionItem";
import { useMateriasParaCursado, postInscribir, postDesinscribir } from "@/lib/sysacadHooks";
import { isGuestMode, triggerGuestBlock } from "@/lib/guest";
import type { SysacadWsUser, SysacadMateriaParaCursado } from "@/lib/sysacadws";

function getWsUser(): SysacadWsUser | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/sysacadws_user=([^;]+)/);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1])) as SysacadWsUser;
  } catch {
    return null;
  }
}

export default function InscripcionPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SysacadWsUser | null>(null);
  const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    setUser(getWsUser());
    setReady(true);
  }, [router]);

  const legajo = user?.legajo;
  const { data, error, isLoading } = useMateriasParaCursado(legajo);
  const sessionExpired = (error as { status?: number } | undefined)?.status === 401;

  const materiasKey = legajo ? `/api/sysacadws/cursado/materiasparacursado/${legajo}` : null;

  async function handleInscribir(materia: SysacadMateriaParaCursado, comision: string) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
    if (!legajo) return;
    setBanner(null);
    const r = await postInscribir(legajo, materia, comision);
    if (r.ok) {
      setBanner({ tone: "ok", text: `Te inscribiste a ${materia.NombreMateria}.` });
      if (materiasKey) globalMutate(materiasKey);
    } else {
      setBanner({ tone: "error", text: r.motivo });
    }
  }

  async function handleDesinscribir(materia: SysacadMateriaParaCursado) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
    if (!legajo) return;
    setBanner(null);
    const r = await postDesinscribir(legajo, materia);
    if (r.ok) {
      setBanner({ tone: "ok", text: `Te desinscribiste de ${materia.NombreMateria}.` });
      if (materiasKey) globalMutate(materiasKey);
    } else {
      setBanner({ tone: "error", text: r.motivo });
    }
  }

  function handleLoginSuccess() {
    setUser(getWsUser());
    globalMutate(() => true);
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <Navbar />
      </div>
    );
  }

  const materias = data?.Materias ?? [];
  const inscriptas = materias.filter((m) => m.Comision !== "0");
  const disponibles = materias.filter((m) => m.Comision === "0");

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 pb-12 pt-12">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Sysacad", href: "/sysacad" },
            { label: "Inscripción" },
          ]}
        />

        {!user || sessionExpired ? (
          <div className="flex flex-col items-center pt-6">
            {sessionExpired && (
              <div className="mb-4 w-full max-w-sm rounded-2xl border border-[#ffe0b2] bg-[#fff8f0] px-4 py-3 text-center text-[13px] text-[#ff9500] dark:border-[rgba(255,149,0,0.25)] dark:bg-[rgba(255,149,0,0.08)]">
                Tu sesión de Sysacad expiró. Volvé a iniciar sesión para ver tus datos.
              </div>
            )}
            <SysacadWsLogin onSuccess={handleLoginSuccess} />
          </div>
        ) : (
          <div className="space-y-4">
            {banner && (
              <div
                className={
                  banner.tone === "ok"
                    ? "rounded-2xl border border-[#34c75933] bg-[#34c7590d] px-4 py-3 text-[13px] font-medium text-[#34c759]"
                    : "rounded-2xl border border-[#ffcdd2] bg-[#fff2f2] px-4 py-3 text-[13px] font-medium text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]"
                }
              >
                {banner.text}
              </div>
            )}

            {isLoading && (
              <p className="py-8 text-center text-[14px] text-[var(--secondary)]">Cargando materias…</p>
            )}

            {!isLoading && materias.length === 0 && (
              <p className="py-8 text-center text-[14px] text-[var(--secondary)]">
                No hay materias para cursado en este momento.
              </p>
            )}

            {!isLoading && inscriptas.length > 0 && (
              <section>
                <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Inscripto
                </p>
                <div className="space-y-2.5">
                  {inscriptas.map((m) => (
                    <MateriaInscripcionItem
                      key={m.IdMateria}
                      legajo={legajo!}
                      materia={m}
                      mode="inscripta"
                      onInscribir={handleInscribir}
                      onDesinscribir={handleDesinscribir}
                    />
                  ))}
                </div>
              </section>
            )}

            {!isLoading && disponibles.length > 0 && (
              <section>
                <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Podés inscribirte
                </p>
                <div className="space-y-2.5">
                  {disponibles.map((m) => (
                    <MateriaInscripcionItem
                      key={m.IdMateria}
                      legajo={legajo!}
                      materia={m}
                      mode="disponible"
                      onInscribir={handleInscribir}
                      onDesinscribir={handleDesinscribir}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds, `/sysacad/inscripcion` appears in the route list
the build prints.

- [ ] **Step 4: Manual end-to-end verification (guest mode)**

Run: `npm run dev`, open the app in a browser, enter guest mode from the
login page, and:

1. Go to `/sysacad` — confirm the aurora button now navigates to a real page
   instead of 404.
2. On `/sysacad/inscripcion`, confirm two sections render: "Inscripto" with
   3 materias (Sistemas de Información, Gestión de Proyectos, Seguridad
   Informática) and "Podés inscribirte" with 3 materias (Auditoria de
   Sistemas, Calidad de Software, Sistemas de Información 2).
3. Expand "Auditoria de Sistemas" and "Calidad de Software" (same mock
   comisiones for both, since the guest mock ignores materia id) — confirm
   it shows 2 radio options with horario/aula, "Inscribirme" disabled until
   one is picked, then enabled.
4. Click "Inscribirme" after picking one — confirm a green banner appears
   ("Te inscribiste a…") — this call fails against the real Sysacad WS in
   guest mode is not applicable here since it's mocked data with a real
   proxy passthrough; in guest mode the POST branch returns 403, so instead
   confirm you see the **guest-block modal** (login prompt), not the green
   banner — this is the expected guest-mode behavior per `isGuestMode()` +
   `triggerGuestBlock()` intercepting before the fetch ever fires.
5. Click "Desinscribirme" on one of the already-inscripted materias — again
   confirm the guest-block modal appears instead of a real mutation.
6. Confirm dark mode renders the banner colors and card borders legibly.

- [ ] **Step 5: Commit**

```bash
git add app/sysacad/inscripcion/page.tsx
git commit -m "feat(sysacad): add /sysacad/inscripcion page"
```

---

## Post-plan note

The real (non-guest) inscribir/desinscribir flow cannot be exercised safely
in this environment — it would modify the user's actual Sysacad enrollment.
Task 3's manual verification only confirms guest-mode blocking and the mock
GET responses. Before relying on this in production, the user should
smoke-test the real flow once with their own account on a materia they don't
mind toggling, and report back if the URL shape or response parsing needs
adjustment (e.g. if a real `Comision === "0"` materia's `comisiones` call
ever returns a `Materia` field that doesn't match `IdMateria` — the plan
assumes the WS is internally consistent per the captured traffic).
