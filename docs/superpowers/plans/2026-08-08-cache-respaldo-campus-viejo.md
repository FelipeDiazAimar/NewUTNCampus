# Cache de respaldo del campus viejo (Moodle) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the legacy Moodle campus (`https://frsfco.cvg.utn.edu.ar`) fails to respond (network error or 5xx), serve the last successfully-scraped copy of a course's contents or a user's enrolled-courses list from a new Supabase `moodle_cache` table instead of erroring out, silently and with no "stale data" indicator.

**Architecture:** A single key-value table `moodle_cache` (`cache_key text primary key`, `payload jsonb`, `updated_at timestamptz`) stores the exact JSON payloads that `app/api/course/route.ts`, `app/api/courses/route.ts`, and `app/api/moodle/route.ts` already build. A new `lib/contentCache.ts` module wraps reads/writes to that table with the same best-effort try/catch pattern as `lib/deviceSessions.ts`. Each of the three routes writes through to the cache (fire-and-forget) after a successful live fetch, and falls back to reading the cache only in the specific `catch` blocks that represent Moodle being unreachable — never on session/auth failures, which keep their current behavior. Separately, `lib/cookies.ts` gets a longer `REMEMBER_MAX_AGE` so "remember me" sessions survive longer outages.

**Tech Stack:** Next.js App Router (Node runtime), TypeScript, Supabase REST (`lib/supabase.ts` → `supabaseFetch`, service-role key, no ORM).

## Global Constraints

- No test suite exists in this repo (stated in `CLAUDE.md`) — do not add one. Verify with `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual `curl`/browser checks against the dev server.
- All `moodle_cache` I/O (write and read) is best-effort: Supabase failures or a missing table must never throw or change the shape of a route's existing successful response.
- Cache reads only happen on network-level failures (fetch throws, or Moodle responds 5xx) — never when Moodle responds but redirects to `/login/` (expired session) and never when the session cookie is simply missing. Those cases keep returning their current error responses unchanged.
- The fallback is silent: cached responses must have the exact same JSON shape as live responses (`{ data, courseName }` for course contents, `{ data }` for course lists) — no extra `cached: true` field, no timestamp exposed to the client.
- `course:<courseId>` cache entries are shared across all users (course structure doesn't depend on who's asking). `courses:<userid>` entries are per-user.
- Writes to the cache must never block or delay the response already being sent to the user (fire-and-forget, no `await`).
- `@/*` maps to the project root.

---

### Task 1: Create the `moodle_cache` table in Supabase (manual)

**Files:** none (Supabase dashboard action — this repo has no migration tooling).

- [ ] **Step 1: Run this SQL against the project's Supabase database (SQL editor in the dashboard)**

```sql
create table moodle_cache (
  cache_key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 2: Confirm the table exists**

In the Supabase dashboard's Table Editor, confirm `moodle_cache` appears with columns `cache_key, payload, updated_at`. There's nothing to `curl` yet — end-to-end verification happens in Tasks 3-5, once the write/read code exists.

No commit for this task (no files changed in the repo).

---

### Task 2: `lib/contentCache.ts` — read/write helpers

**Files:**
- Create: `lib/contentCache.ts`

**Interfaces:**
- Consumes: `supabaseFetch` from `lib/supabase.ts`; `MoodleCourse`, `MoodleCourseSection` types from `lib/moodle.ts`.
- Produces: `getCachedCourse(courseId: number): Promise<CachedCourse | null>`, `setCachedCourse(courseId: number, data: CachedCourse): void`, `getCachedCourses(userId: number): Promise<MoodleCourse[] | null>`, `setCachedCourses(userId: number, courses: MoodleCourse[]): void`, and the `CachedCourse` type. Consumed by Tasks 3, 4, and 5.

- [ ] **Step 1: Write the file**

```ts
import { supabaseFetch } from "@/lib/supabase";
import type { MoodleCourse, MoodleCourseSection } from "@/lib/moodle";

/**
 * Respaldo de solo-lectura del campus viejo (Moodle) en Supabase
 * (`moodle_cache`): una tabla clave-valor genérica que guarda la última
 * respuesta exitosa de cada recurso, para poder seguir mostrando contenido
 * ya visto cuando Moodle no responde (caída, mantenimiento, red).
 *
 * `course:<id>` se comparte entre todos los alumnos de esa materia (la
 * estructura de secciones/módulos no depende de quién la pide).
 * `courses:<userId>` es por usuario (cada uno está inscripto en cursos
 * distintos).
 *
 * Todo es best-effort, igual que `lib/deviceSessions.ts`: si Supabase falla
 * o la tabla no existe, las funciones degradan en silencio — nunca deben
 * romper una respuesta que de otra forma sería exitosa (escritura) ni
 * inventar un error nuevo (lectura, donde `null` significa "no hay
 * respaldo, seguí con el error original").
 */

const TABLE = "moodle_cache";

export type CachedCourse = {
  sections: MoodleCourseSection[];
  courseName: string;
};

function courseKey(courseId: number): string {
  return `course:${courseId}`;
}

function coursesKey(userId: number): string {
  return `courses:${userId}`;
}

async function readPayload<T>(cacheKey: string): Promise<T | null> {
  try {
    const res = await supabaseFetch(
      `${TABLE}?cache_key=eq.${encodeURIComponent(cacheKey)}&select=payload`
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { payload: T }[];
    return rows[0]?.payload ?? null;
  } catch {
    return null;
  }
}

async function writePayload(cacheKey: string, payload: unknown): Promise<void> {
  try {
    await supabaseFetch(`${TABLE}?on_conflict=cache_key`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        cache_key: cacheKey,
        payload,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    /* best-effort */
  }
}

export async function getCachedCourse(courseId: number): Promise<CachedCourse | null> {
  return readPayload<CachedCourse>(courseKey(courseId));
}

/** Fire-and-forget: no se espera en el camino de lectura ni de escritura. */
export function setCachedCourse(courseId: number, data: CachedCourse): void {
  void writePayload(courseKey(courseId), data);
}

export async function getCachedCourses(userId: number): Promise<MoodleCourse[] | null> {
  return readPayload<MoodleCourse[]>(coursesKey(userId));
}

/** Fire-and-forget: no se espera en el camino de lectura ni de escritura. */
export function setCachedCourses(userId: number, courses: MoodleCourse[]): void {
  void writePayload(coursesKey(userId), courses);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `lib/contentCache.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/contentCache.ts
git commit -m "feat: add moodle_cache read/write helpers"
```

---

### Task 3: Wire the cache into `app/api/course/route.ts`

**Files:**
- Modify: `app/api/course/route.ts`

**Interfaces:**
- Consumes: `getCachedCourse`, `setCachedCourse`, `CachedCourse` from `lib/contentCache.ts` (Task 2).

The current `GET` handler (lines 293-396) does one `fetch` to `course/view.php` inside a `try`, and on any thrown error returns `{ error: message }` with status 500 in the `catch` (lines 392-395). We need to:
1. On success, fire-and-forget a cache write with the final `sections`/`courseName` before returning.
2. On failure of that specific outer `fetch`/scrape (the `catch` block), try the cache before giving up.

The existing `if (mainRes.url.includes("/login/"))` check (line 315) already returns `401 No autenticado` *without* throwing, so it never reaches the `catch` — that path is untouched, as required (expired session ≠ Moodle down).

- [ ] **Step 1: Add the import**

In `app/api/course/route.ts`, alongside the existing imports (near line 8):

```ts
import { getCachedCourse, setCachedCourse } from "@/lib/contentCache";
```

- [ ] **Step 2: Treat a 5xx from Moodle as "down" too, not just thrown network errors**

Replace:

```ts
    const mainRes = await fetch(`${MOODLE_BASE}/course/view.php?id=${courseId}`, {
      headers: { Cookie: cookie },
    });
    if (mainRes.url.includes("/login/")) {
```

with:

```ts
    const mainRes = await fetch(`${MOODLE_BASE}/course/view.php?id=${courseId}`, {
      headers: { Cookie: cookie },
    });
    if (mainRes.status >= 500) {
      // Moodle caído a nivel servidor: tratarlo igual que un error de red,
      // para que el catch de abajo intente el respaldo en cache.
      throw new Error(`Moodle respondió ${mainRes.status}`);
    }
    if (mainRes.url.includes("/login/")) {
```

- [ ] **Step 3: Write through to the cache before the successful return**

Replace:

```ts
    return NextResponse.json({ data: sections, courseName });
  } catch (err) {
    console.error("[course] error:", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
```

with:

```ts
    setCachedCourse(Number(courseId), { sections, courseName });
    return NextResponse.json({ data: sections, courseName });
  } catch (err) {
    console.error("[course] error:", (err as Error).message);
    const cached = await getCachedCourse(Number(courseId));
    if (cached) {
      return NextResponse.json({ data: cached.sections, courseName: cached.courseName });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Manual verification — happy path writes the cache**

With the dev server running (`npm run dev`) and a valid logged-in session cookie, open a course page in the browser (`/course/<id>`), then check the Supabase Table Editor: a row `course:<id>` should exist in `moodle_cache` with a recent `updated_at`.

- [ ] **Step 6: Manual verification — fallback on failure**

Temporarily edit `lib/moodle.ts`'s `MOODLE_BASE` (or add a one-line override at the top of the `GET` handler for this test only, then revert it) to an unreachable host, e.g. `http://127.0.0.1:9` (nothing listens there → connection refused). Reload the same course page: it should render the same content as before (from cache), not an error. Revert the temporary override afterward.

- [ ] **Step 7: Commit**

```bash
git add app/api/course/route.ts
git commit -m "feat: fall back to cached course content when Moodle is unreachable"
```

---

### Task 4: Wire the cache into `app/api/courses/route.ts`

**Files:**
- Modify: `app/api/courses/route.ts`

**Interfaces:**
- Consumes: `getCachedCourses`, `setCachedCourses` from `lib/contentCache.ts` (Task 2).

This route's `GET` (lines 207-235) needs the requesting user's id to key the cache, but today it never decodes `moodle_user` — it only reads `moodle_session_token`. Add that decode, mirroring the pattern already used client-side in `lib/hooks.ts`'s `getUserId` (parses the `moodle_user` cookie JSON, reads `.userid`).

- [ ] **Step 1: Add the import**

```ts
import { getCachedCourses, setCachedCourses } from "@/lib/contentCache";
```

- [ ] **Step 2: Add a helper to read the user id from the request, and use it**

Replace:

```ts
export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const res = await fetch(`${MOODLE_BASE}/my/courses.php`, {
      headers: { Cookie: `MoodleSession=${sessionToken}` },
    });
    const html = await res.text();
    if (res.url.includes("/login/") || html.includes("logintoken")) {
      return NextResponse.json({ error: "Sesion expirada" }, { status: 401 });
    }
    let courses = parseCourses(html);
    if (courses.length === 0) {
      const sesskey = parseSesskey(html);
      if (sesskey) {
        courses = await fetchAjaxCourses(sessionToken, sesskey);
      }
    }
    return NextResponse.json({ data: courses });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Error al obtener cursos" },
      { status: 500 }
    );
  }
}
```

with:

```ts
function getUserId(req: NextRequest): number | undefined {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { userid?: number };
    return parsed.userid;
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const userId = getUserId(req);

  try {
    const res = await fetch(`${MOODLE_BASE}/my/courses.php`, {
      headers: { Cookie: `MoodleSession=${sessionToken}` },
    });
    if (res.status >= 500) {
      // Moodle caído a nivel servidor: tratarlo igual que un error de red,
      // para que el catch de abajo intente el respaldo en cache.
      throw new Error(`Moodle respondió ${res.status}`);
    }
    const html = await res.text();
    if (res.url.includes("/login/") || html.includes("logintoken")) {
      return NextResponse.json({ error: "Sesion expirada" }, { status: 401 });
    }
    let courses = parseCourses(html);
    if (courses.length === 0) {
      const sesskey = parseSesskey(html);
      if (sesskey) {
        courses = await fetchAjaxCourses(sessionToken, sesskey);
      }
    }
    if (courses.length > 0 && userId) {
      setCachedCourses(userId, courses);
    }
    return NextResponse.json({ data: courses });
  } catch (err) {
    if (userId) {
      const cached = await getCachedCourses(userId);
      if (cached) return NextResponse.json({ data: cached });
    }
    return NextResponse.json(
      { error: (err as Error).message || "Error al obtener cursos" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

With a valid session, hit `GET /api/courses` directly (e.g. via browser devtools `fetch("/api/courses").then(r=>r.json()).then(console.log)` on the app's origin, so cookies are sent) and confirm a `courses:<userid>` row appears in `moodle_cache`. Then repeat the unreachable-host trick from Task 3, Step 5, and confirm the same endpoint still returns the cached `data` array instead of an error.

- [ ] **Step 5: Commit**

```bash
git add app/api/courses/route.ts
git commit -m "feat: fall back to cached course list when Moodle is unreachable"
```

---

### Task 5: Wire the cache into `app/api/moodle/route.ts` (course-list methods only)

**Files:**
- Modify: `app/api/moodle/route.ts`

**Interfaces:**
- Consumes: `getCachedCourses`, `setCachedCourses` from `lib/contentCache.ts` (Task 2).

This route is a generic proxy for many Moodle AJAX `methodname`s (messages, notifications, courses, …). Only the two course-listing methods participate in the cache; everything else is untouched — a network failure sending a message, for instance, must keep failing normally.

- [ ] **Step 1: Add the import and a helper to read the user id**

Add near the top imports:

```ts
import { getCachedCourses, setCachedCourses } from "@/lib/contentCache";
```

Add a small helper (same shape as the one added in Task 4, duplicated here on purpose — this file doesn't import from `app/api/courses/route.ts`, and a two-line cookie parse doesn't justify a shared module):

```ts
const COURSE_LIST_METHODS = new Set([
  "core_course_get_enrolled_courses_by_timeline_classification",
  "core_enrol_get_users_courses",
]);

function getUserId(req: NextRequest): number | undefined {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { userid?: number };
    return parsed.userid;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 2: Capture `methodname`/`userId` before the try, write through on success, fall back in the catch**

The current authenticated (non-guest) path is:

```ts
  const { methodname, args } = await req.json();

  try {
    const raw = await fetch(
      `${MOODLE_BASE}/lib/ajax/service.php?sesskey=${sesskey}&info=${methodname}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: moodleCookie,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify([{ index: 0, methodname, args }]),
      }
    );
    // Moodle puede regenerar la sesión en cualquier request: capturamos el token
    // rotado para que las llamadas siguientes no fallen por sesión vencida.
    const rotated = raw.headers.get("set-cookie")?.match(/MoodleSession=([^;]+)/)?.[1];

    const text = await raw.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      console.error("[moodle proxy] response is not JSON");
      return NextResponse.json({ error: "Moodle returned non-JSON response" }, { status: 500 });
    }
    const arr = json as Array<{ error?: boolean; exception?: { message?: string; errorcode?: string }; data?: unknown }>;
    if (arr[0]?.error) {
      const msg = arr[0].exception?.message ?? arr[0].exception?.errorcode ?? "Error de Moodle";
      console.error("[moodle proxy] Moodle error:", msg, arr[0].exception);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    const response = NextResponse.json({ data: rewriteMoodleUrlsDeep(arr[0]?.data ?? arr[0] ?? {}) });
    // Persistir el token rotado + deslizar la expiración de la sesión con la actividad.
    if (rotated && rotated !== sessionToken) {
      response.cookies.set("moodle_session_token", rotated, sessionCookieOptions(keep, true));
    }
    return response;
  } catch (err) {
    console.error("[moodle proxy] fetch error:", (err as Error).message);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
```

Replace it with:

```ts
  const { methodname, args } = await req.json();
  const userId = getUserId(req);
  const isCourseList = COURSE_LIST_METHODS.has(methodname);

  try {
    const raw = await fetch(
      `${MOODLE_BASE}/lib/ajax/service.php?sesskey=${sesskey}&info=${methodname}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: moodleCookie,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify([{ index: 0, methodname, args }]),
      }
    );
    if (raw.status >= 500) {
      // Moodle caído a nivel servidor: tratarlo igual que un error de red,
      // para que el catch de abajo intente el respaldo en cache (solo aplica
      // a isCourseList — el resto de los métodos simplemente fallan).
      throw new Error(`Moodle respondió ${raw.status}`);
    }
    // Moodle puede regenerar la sesión en cualquier request: capturamos el token
    // rotado para que las llamadas siguientes no fallen por sesión vencida.
    const rotated = raw.headers.get("set-cookie")?.match(/MoodleSession=([^;]+)/)?.[1];

    const text = await raw.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      console.error("[moodle proxy] response is not JSON");
      return NextResponse.json({ error: "Moodle returned non-JSON response" }, { status: 500 });
    }
    const arr = json as Array<{ error?: boolean; exception?: { message?: string; errorcode?: string }; data?: unknown }>;
    if (arr[0]?.error) {
      const msg = arr[0].exception?.message ?? arr[0].exception?.errorcode ?? "Error de Moodle";
      console.error("[moodle proxy] Moodle error:", msg, arr[0].exception);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    const data = rewriteMoodleUrlsDeep(arr[0]?.data ?? arr[0] ?? {});
    if (isCourseList && userId) {
      const courses = (data as { courses?: unknown }).courses ?? data;
      if (Array.isArray(courses) && courses.length > 0) {
        setCachedCourses(userId, courses as Parameters<typeof setCachedCourses>[1]);
      }
    }
    const response = NextResponse.json({ data });
    // Persistir el token rotado + deslizar la expiración de la sesión con la actividad.
    if (rotated && rotated !== sessionToken) {
      response.cookies.set("moodle_session_token", rotated, sessionCookieOptions(keep, true));
    }
    return response;
  } catch (err) {
    console.error("[moodle proxy] fetch error:", (err as Error).message);
    if (isCourseList && userId) {
      const cached = await getCachedCourses(userId);
      if (cached) {
        return NextResponse.json({
          data:
            methodname === "core_course_get_enrolled_courses_by_timeline_classification"
              ? { courses: cached }
              : cached,
        });
      }
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
```

This preserves each method's original response shape: `core_course_get_enrolled_courses_by_timeline_classification` returns `{ data: { courses: [...] } }` (matching `lib/hooks.ts`'s `json.data.courses`), while `core_enrol_get_users_courses` returns `{ data: [...] }` directly (matching `lib/hooks.ts`'s `Array.isArray(fallbackJson.data)`).

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

Log in normally, load the dashboard (which triggers `core_course_get_enrolled_courses_by_timeline_classification` via `/api/moodle`), confirm a `courses:<userid>` row appears/updates in `moodle_cache`. Repeat the unreachable-host trick and reload the dashboard: it should still show the same course list. Then, separately, confirm an unrelated method (e.g. opening `/chat`, which calls `core_message_get_conversations`) still returns a normal error when Moodle is unreachable — it must NOT silently succeed with stale/empty data.

- [ ] **Step 5: Commit**

```bash
git add app/api/moodle/route.ts
git commit -m "feat: fall back to cached course list in the moodle AJAX proxy"
```

---

### Task 6: Extend `REMEMBER_MAX_AGE` to 90 days

**Files:**
- Modify: `lib/cookies.ts:9`

- [ ] **Step 1: Change the constant**

Replace:

```ts
export const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30; // 30 días
```

with:

```ts
export const REMEMBER_MAX_AGE = 60 * 60 * 24 * 90; // 90 días
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (this is a pure constant change, nothing else references the literal `30`).

- [ ] **Step 3: Commit**

```bash
git add lib/cookies.ts
git commit -m "feat: extend remembered-session cookie lifetime to 90 days"
```

---

### Task 7: Full build check

**Files:** none.

- [ ] **Step 1: Run the full build**

Run: `npm run build`
Expected: builds successfully with no new type or lint errors introduced by Tasks 2-6.

- [ ] **Step 2: Manual end-to-end pass**

Repeat the three manual verifications from Tasks 3, 4, and 5 once more in sequence against the production build (`npm run start`) if convenient, or against `npm run dev`: normal load populates the cache, simulated Moodle outage serves cached data silently for course contents and course lists, and unrelated Moodle actions (messages, notifications) still fail normally when Moodle is unreachable.

No commit for this task (verification only).
