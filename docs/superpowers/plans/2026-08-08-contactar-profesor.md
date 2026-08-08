# Contactar Profesor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student open the professors of a materia from `/materia/[slug]` and jump straight into a chat with one of them.

**Architecture:** A new scrape-based API route (`/api/participants`) reads Moodle's Participantes page and returns only professors. A new modal component fetches that list on demand and links each professor to `/chat?userid=N`. The chat page gains a `useEffect` that reads that query param and opens/creates the corresponding conversation, following the existing `Suspense`+`useSearchParams` pattern already used on `/dashboard/calendario`.

**Tech Stack:** Next.js App Router (client components), plain regex HTML scraping (existing convention in `app/api/course/route.ts` and `app/api/userprofile/route.ts`), no test framework in this repo (see `CLAUDE.md` — verification is manual/scripted, not `pytest`/`jest`-style).

## Global Constraints

- No test suite is configured in this repo — every task's "test cycle" is a throwaway Node verification script (deleted after use, lives in the scratchpad, never committed) plus `npx tsc --noEmit` for type-safety, plus a manual browser check where the UI is involved.
- `@/*` maps to the project root (`tsconfig.json` path alias) — use it for all internal imports.
- All Moodle-origin URLs (avatars, etc.) must be proxied via `toProxyPath`/`/api/cvg` before reaching the client — never leak `frsfco.cvg.utn.edu.ar` URLs directly (see `CLAUDE.md` API proxy pattern and existing `proxyImageSrc`/`proxiedAvatar` helpers).
- Styling is iOS HIG hex literals in JSX (`#007aff` accent, `var(--fg)`, `var(--surface)`, etc.) — no Tailwind color tokens, matching `CLAUDE.md`.
- Guest mode (`isGuestRequest` server-side, `isGuestMode`/`triggerGuestBlock` client-side, both in `lib/guest.ts`) must never break — guest users get an empty professors list, and guest chat writes are already blocked elsewhere.

---

## File Structure

- **Create** `lib/participants.ts` — pure parsing logic: `parseParticipants(html): Professor[]`, exported `Professor` type. No network calls, no Next.js imports beyond `@/lib/moodle`. Kept separate from the route so it can be exercised by a plain Node script without booting Next.
- **Create** `app/api/participants/route.ts` — thin route handler: auth/guest checks, fetch Moodle, call `parseParticipants`, respond JSON. Mirrors `app/api/userprofile/route.ts`.
- **Create** `components/ContactProfessorModal.tsx` — iOS-style modal, same visual language as `components/ComingSoonModal.tsx`. Fetches `/api/participants`, renders professor rows, navigates to `/chat?userid=N`.
- **Modify** `app/materia/[slug]/page.tsx` — add "Contactar Profesor" button in the header block (~line 478-502) and mount the modal.
- **Modify** `app/chat/page.tsx` — wrap in `Suspense` (matching `app/dashboard/calendario/page.tsx`'s pattern), add `useSearchParams`-driven effect that opens/creates a conversation from `?userid=`.

---

### Task 1: `lib/participants.ts` — parse professors out of Moodle's Participantes HTML

**Files:**
- Create: `lib/participants.ts`
- Test: throwaway script at `C:\Users\Asus\AppData\Local\Temp\claude\c--Users-Asus-Desktop-Facultad-IP-Calculator-Campus-campus-utn\94dd629e-dc61-4524-801c-221a06138c07\scratchpad\verify-participants.js` (Node, CommonJS — deleted after Step 4, never committed)
- Fixture used by the script: `harfiles/participantes/sourcefile.html` (already in the repo, real scraped Moodle Participantes page for course id 2201 — 20 rows visible, one professor: "Diego Gandino", id 2151, no photo)

**Interfaces:**
- Produces: `export interface Professor { id: number; name: string; avatarUrl: string | null }` and `export function parseParticipants(html: string): Professor[]` — used by Task 2 (route) as the only export consumed outside this file.

- [ ] **Step 1: Write the throwaway verification script with a deliberately wrong implementation**

Create `C:\Users\Asus\AppData\Local\Temp\claude\c--Users-Asus-Desktop-Facultad-IP-Calculator-Campus-campus-utn\94dd629e-dc61-4524-801c-221a06138c07\scratchpad\verify-participants.js`:

```js
const fs = require("fs");
const path = require("path");

// Placeholder — intentionally wrong, to prove this check can fail.
function parseParticipants(html) {
  return [];
}

const html = fs.readFileSync(
  path.join(
    "c:/Users/Asus/Desktop/Facultad/IP-Calculator/Campus/campus-utn",
    "harfiles/participantes/sourcefile.html"
  ),
  "utf8"
);

const professors = parseParticipants(html);

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}: expected ${e}, got ${a}`);
    process.exit(1);
  }
  console.log(`OK ${label}`);
}

assertEqual(professors.length, 1, "professors.length");
assertEqual(
  professors[0],
  { id: 2151, name: "Diego Gandino", avatarUrl: null },
  "professors[0]"
);

console.log("ALL PASS");
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node "C:\Users\Asus\AppData\Local\Temp\claude\c--Users-Asus-Desktop-Facultad-IP-Calculator-Campus-campus-utn\94dd629e-dc61-4524-801c-221a06138c07\scratchpad\verify-participants.js"`
Expected: `FAIL professors.length: expected 1, got 0` and a non-zero exit code.

- [ ] **Step 3: Replace the placeholder in the script with the real parsing logic**

Edit the script's `parseParticipants` function to:

```js
function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseParticipants(html) {
  const tableMatch = html.match(/<table[^>]*id="participants"[^>]*>[\s\S]*?<\/table>/);
  if (!tableMatch) return [];
  const table = tableMatch[0];

  const rowRe =
    /<th class="cell c1"[^>]*>[\s\S]*?<a[^>]*href="[^"]*user\/view\.php\?id=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a><\/th>[\s\S]*?<td class="cell c2"[^>]*>([\s\S]*?)<\/td>/g;

  const professors = [];
  let m;
  while ((m = rowRe.exec(table))) {
    const id = parseInt(m[1], 10);
    const anchorInner = m[2];
    const role = decodeEntities(m[3].replace(/<[^>]+>/g, "")).trim();
    if (!role.includes("Profesor")) continue;

    const imgSrc = anchorInner.match(/<img[^>]*src="([^"]+)"/)?.[1] ?? null;
    const name = decodeEntities(anchorInner.replace(/<[^>]+>/g, "")).trim();
    professors.push({ id, name, avatarUrl: imgSrc });
  }
  return professors;
}
```

- [ ] **Step 4: Run it again and confirm it passes, then delete the script**

Run: `node "C:\Users\Asus\AppData\Local\Temp\claude\c--Users-Asus-Desktop-Facultad-IP-Calculator-Campus-campus-utn\94dd629e-dc61-4524-801c-221a06138c07\scratchpad\verify-participants.js"`
Expected: three `OK` lines followed by `ALL PASS`, exit code 0.

Delete the script (it was only a scratchpad tool, never add it to the repo):
`rm "C:\Users\Asus\AppData\Local\Temp\claude\c--Users-Asus-Desktop-Facultad-IP-Calculator-Campus-campus-utn\94dd629e-dc61-4524-801c-221a06138c07\scratchpad\verify-participants.js"`

- [ ] **Step 5: Port the verified logic into `lib/participants.ts`**

```ts
export interface Professor {
  id: number;
  name: string;
  avatarUrl: string | null;
}

function decodeEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Parses the "Participantes" table Moodle renders at `/user/index.php?id=N`
 * and returns only the rows whose role column contains "Profesor" (covers
 * both "Profesor" and "Profesor sin permiso de edición"). `avatarUrl` is the
 * raw Moodle URL — callers must proxy it (see `toProxyPath` in lib/moodle.ts)
 * before sending it to the client.
 */
export function parseParticipants(html: string): Professor[] {
  const tableMatch = html.match(/<table[^>]*id="participants"[^>]*>[\s\S]*?<\/table>/);
  if (!tableMatch) return [];
  const table = tableMatch[0];

  const rowRe =
    /<th class="cell c1"[^>]*>[\s\S]*?<a[^>]*href="[^"]*user\/view\.php\?id=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a><\/th>[\s\S]*?<td class="cell c2"[^>]*>([\s\S]*?)<\/td>/g;

  const professors: Professor[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(table))) {
    const id = parseInt(m[1], 10);
    const anchorInner = m[2];
    const role = decodeEntities(m[3].replace(/<[^>]+>/g, "")).trim();
    if (!role.includes("Profesor")) continue;

    const imgSrc = anchorInner.match(/<img[^>]*src="([^"]+)"/)?.[1] ?? null;
    const name = decodeEntities(anchorInner.replace(/<[^>]+>/g, "")).trim();
    professors.push({ id, name, avatarUrl: imgSrc });
  }
  return professors;
}
```

- [ ] **Step 6: Typecheck**

Run: `cd "c:/Users/Asus/Desktop/Facultad/IP-Calculator/Campus/campus-utn" && npx tsc --noEmit`
Expected: no errors mentioning `lib/participants.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/participants.ts
git commit -m "feat: add Moodle participants HTML parser for professors"
```

---

### Task 2: `GET /api/participants` route

**Files:**
- Create: `app/api/participants/route.ts`

**Interfaces:**
- Consumes: `parseParticipants(html: string): Professor[]` and `Professor` type from `@/lib/participants` (Task 1); `MOODLE_BASE`, `toProxyPath` from `@/lib/moodle`; `isGuestRequest` from `@/lib/guest`.
- Produces: `GET /api/participants?id={courseId}` → `200 { professors: Professor[] }` | `400 { error }` | `401 { error }` | `502 { error }`. Consumed by Task 3's `ContactProfessorModal`.

- [ ] **Step 1: Write the route handler**

```ts
import { NextRequest, NextResponse } from "next/server";
import { MOODLE_BASE, toProxyPath } from "@/lib/moodle";
import { isGuestRequest } from "@/lib/guest";
import { parseParticipants, type Professor } from "@/lib/participants";

export const runtime = "nodejs";

/**
 * GET /api/participants?id=N
 * Scrapes /user/index.php?id=N (Moodle's Participantes page) and returns only
 * professors — used to populate the "Contactar Profesor" modal.
 */
export async function GET(req: NextRequest) {
  if (isGuestRequest(req)) {
    return NextResponse.json({ professors: [] });
  }

  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const courseId = req.nextUrl.searchParams.get("id");
  if (!courseId || !/^\d+$/.test(courseId)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const cookie = `MoodleSession=${sessionToken}`;

  try {
    const res = await fetch(`${MOODLE_BASE}/user/index.php?id=${courseId}&perpage=5000`, {
      headers: { Cookie: cookie },
    });
    if (res.url.includes("/login/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const html = await res.text();
    const professors: Professor[] = parseParticipants(html).map((p) => ({
      ...p,
      avatarUrl: p.avatarUrl ? toProxyPath(p.avatarUrl) : null,
    }));

    return NextResponse.json({ professors });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "c:/Users/Asus/Desktop/Facultad/IP-Calculator/Campus/campus-utn" && npx tsc --noEmit`
Expected: no errors mentioning `app/api/participants/route.ts`.

- [ ] **Step 3: Manual smoke test against the real Moodle backend**

Run: `cd "c:/Users/Asus/Desktop/Facultad/IP-Calculator/Campus/campus-utn" && npm run dev`
In a browser, log in normally at `http://localhost:3000`, then navigate to `http://localhost:3000/api/participants?id=2201` (2201 is the course id from the `harfiles/participantes` fixture — swap for any real enrolled course id shown in `/dashboard`).
Expected: JSON body `{"professors":[{"id":2151,"name":"Diego Gandino","avatarUrl":null}, ...]}` (exact professors depend on current live enrollment, but the shape must match and no student names should appear). Also try a bad id (`?id=999999999`) and confirm it responds `200 { "professors": [] }` (Moodle just returns an empty/absent table, not an error) rather than crashing.

- [ ] **Step 4: Commit**

```bash
git add app/api/participants/route.ts
git commit -m "feat: add /api/participants endpoint for course professors"
```

---

### Task 3: `ContactProfessorModal` component

**Files:**
- Create: `components/ContactProfessorModal.tsx`

**Interfaces:**
- Consumes: `GET /api/participants?id=N` → `{ professors: Professor[] }` (Task 2); `Professor` type from `@/lib/participants`; `Spinner` from `@/components/Spinner`; `getInitials`, `avatarColor` from `@/lib/chat`; `useRouter` from `next/navigation`.
- Produces: `export default function ContactProfessorModal({ courseId, open, onClose }: { courseId: number; open: boolean; onClose: () => void })` — consumed by Task 4 (`app/materia/[slug]/page.tsx`).

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, X } from "lucide-react";
import Spinner from "@/components/Spinner";
import { avatarColor, getInitials } from "@/lib/chat";
import type { Professor } from "@/lib/participants";

interface Props {
  courseId: number;
  open: boolean;
  onClose: () => void;
}

function ProfessorAvatar({ name, url }: { name: string; url: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} className="h-12 w-12 rounded-full object-cover shrink-0" />
  ) : (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ backgroundColor: avatarColor(name), fontSize: 16 }}
    >
      {getInitials(name)}
    </div>
  );
}

export default function ContactProfessorModal({ courseId, open, onClose }: Props) {
  const router = useRouter();
  const [professors, setProfessors] = useState<Professor[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProfessors(null);
    setError(false);
    fetch(`/api/participants?id=${courseId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((data: { professors: Professor[] }) => setProfessors(data.professors))
      .catch(() => setError(true));
  }, [open, courseId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function goToChat(professorId: number) {
    onClose();
    router.push(`/chat?userid=${professorId}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", animation: "fade-in 0.2s ease" }}
      role="dialog"
      aria-modal="true"
    >
      <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={onClose} />

      <div className="relative w-full max-w-[360px] rounded-3xl border border-[var(--separator)] bg-[var(--surface)]/90 backdrop-blur-xl p-6 shadow-2xl max-h-[80vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 w-8 h-8 rounded-full bg-[var(--surface2)] flex items-center justify-center active:opacity-70"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4 text-[var(--secondary)]" />
        </button>

        <h2 className="text-[18px] font-bold text-[var(--fg)] tracking-tight mb-4">
          Contactar Profesor
        </h2>

        {professors === null && !error && (
          <div className="flex justify-center py-8">
            <Spinner size={28} />
          </div>
        )}

        {error && (
          <p className="text-[14px] text-[var(--secondary)] text-center py-8">
            No se pudo cargar la lista de profesores.
          </p>
        )}

        {professors !== null && !error && professors.length === 0 && (
          <p className="text-[14px] text-[var(--secondary)] text-center py-8">
            No se encontraron profesores para esta materia.
          </p>
        )}

        {professors !== null && professors.length > 0 && (
          <div className="flex flex-col gap-2">
            {professors.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-[var(--surface2)] p-3">
                <ProfessorAvatar name={p.name} url={p.avatarUrl} />
                <p className="flex-1 min-w-0 truncate text-[15px] font-semibold text-[var(--fg)]">{p.name}</p>
                <button
                  type="button"
                  onClick={() => goToChat(p.id)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#007aff] px-3.5 py-2 text-[13px] font-semibold text-white active:opacity-80"
                >
                  <MessageCircle className="w-4 h-4" />
                  Comunicarte
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "c:/Users/Asus/Desktop/Facultad/IP-Calculator/Campus/campus-utn" && npx tsc --noEmit`
Expected: no errors mentioning `components/ContactProfessorModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/ContactProfessorModal.tsx
git commit -m "feat: add ContactProfessorModal component"
```

---

### Task 4: Wire the button + modal into `/materia/[slug]`

**Files:**
- Modify: `app/materia/[slug]/page.tsx:1-16` (imports), `app/materia/[slug]/page.tsx:440-547` (`MateriaPage` component)

**Interfaces:**
- Consumes: `ContactProfessorModal` from `@/components/ContactProfessorModal` (Task 3).

- [ ] **Step 1: Add the import**

In `app/materia/[slug]/page.tsx`, after the existing `import { FileViewer } from "@/components/CourseFileViewer";` (line 15), add:

```tsx
import ContactProfessorModal from "@/components/ContactProfessorModal";
import { MessageCircle } from "lucide-react";
```

- [ ] **Step 2: Add state for the modal**

In `MateriaPage`, right after the existing `const [search, setSearch] = useState("");` (around line 447), add:

```tsx
  const [contactOpen, setContactOpen] = useState(false);
```

- [ ] **Step 3: Add the button to the header block**

Replace the course header block (currently lines ~478-502):

```tsx
          {/* Course header — iOS Large Title style */}
          {(courseName || loading) && (
            <div style={{ marginBottom: "24px" }}>
              {loading && !courseName ? (
                <div className="space-y-2">
                  <div className="h-3 w-16 bg-[#e5e5ea] rounded animate-pulse" />
                  <div className="h-8 w-3/4 bg-[#e5e5ea] rounded-lg animate-pulse" />
                </div>
              ) : (
                <>
                  <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: "4px" }}>
                    Materia
                  </p>
                  <h1 style={{ fontSize: "clamp(22px, 5vw, 30px)", fontWeight: "800", color: "var(--fg)", lineHeight: "1.1", letterSpacing: "-0.5px", margin: 0 }}>
                    {courseName}
                  </h1>
                  {!loading && (
                    <p style={{ fontSize: "13px", color: "var(--secondary)", marginTop: "6px" }}>
                      {filtered.length} sección{filtered.length !== 1 ? "es" : ""}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
```

with (adds a flex row and the button, only once the course finished loading):

```tsx
          {/* Course header — iOS Large Title style */}
          {(courseName || loading) && (
            <div style={{ marginBottom: "24px" }} className="flex items-end justify-between gap-3">
              {loading && !courseName ? (
                <div className="space-y-2">
                  <div className="h-3 w-16 bg-[#e5e5ea] rounded animate-pulse" />
                  <div className="h-8 w-3/4 bg-[#e5e5ea] rounded-lg animate-pulse" />
                </div>
              ) : (
                <>
                  <div className="min-w-0">
                    <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: "4px" }}>
                      Materia
                    </p>
                    <h1 style={{ fontSize: "clamp(22px, 5vw, 30px)", fontWeight: "800", color: "var(--fg)", lineHeight: "1.1", letterSpacing: "-0.5px", margin: 0 }}>
                      {courseName}
                    </h1>
                    {!loading && (
                      <p style={{ fontSize: "13px", color: "var(--secondary)", marginTop: "6px" }}>
                        {filtered.length} sección{filtered.length !== 1 ? "es" : ""}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setContactOpen(true)}
                    className="shrink-0 flex items-center gap-1.5 rounded-full bg-[var(--surface2)] px-4 py-2.5 text-[13px] font-semibold text-[#007aff] active:opacity-70 transition-opacity"
                  >
                    <MessageCircle className="w-4 h-4" />
                    Contactar Profesor
                  </button>
                </>
              )}
            </div>
          )}
```

- [ ] **Step 4: Mount the modal**

At the end of `MateriaPage`'s returned JSX, right before the closing `</div>` that matches the outermost `<div className="min-h-screen bg-[var(--bg)] overflow-x-hidden">` (i.e. right after `</WorkspaceLayout>`, currently the last line before `);`), add:

```tsx
      <ContactProfessorModal
        courseId={parseInt(id)}
        open={contactOpen}
        onClose={() => setContactOpen(false)}
      />
```

So the tail of the component becomes:

```tsx
      </WorkspaceLayout>
      <ContactProfessorModal
        courseId={parseInt(id)}
        open={contactOpen}
        onClose={() => setContactOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd "c:/Users/Asus/Desktop/Facultad/IP-Calculator/Campus/campus-utn" && npx tsc --noEmit`
Expected: no errors mentioning `app/materia/[slug]/page.tsx`.

- [ ] **Step 6: Manual browser test**

Run: `cd "c:/Users/Asus/Desktop/Facultad/IP-Calculator/Campus/campus-utn" && npm run dev`
Log in, open any materia (e.g. `http://localhost:3000/materia/2423-programacion-web-2026`). Confirm:
- The header now shows the title/section-count on the left and a pill button "Contactar Profesor" aligned to the bottom-right of that row.
- Clicking it opens the modal with a spinner, then either the professor list (photo/initials + name + "Comunicarte" button) or the "No se encontraron profesores" empty state.
- Clicking outside the modal or the X closes it.

- [ ] **Step 7: Commit**

```bash
git add "app/materia/[slug]/page.tsx"
git commit -m "feat: add Contactar Profesor button to materia header"
```

---

### Task 5: `/chat` opens a conversation from `?userid=`

**Files:**
- Modify: `app/chat/page.tsx` (whole file — wraps the existing default export in `Suspense`, renames the inner component, adds one effect)

**Interfaces:**
- Consumes: `GET /api/userprofile?userid=N` → `{ id, name, email, city, country, lastAccess }` (already exists, `app/api/userprofile/route.ts`); `useSearchParams` from `next/navigation`.
- Produces: no new exports — `ChatPage` (default export) keeps the same signature (`() => JSX.Element`), now wrapped in `Suspense`.

- [ ] **Step 1: Rename the existing component and wrap it**

In `app/chat/page.tsx`:
1. Add `Suspense` and `useSearchParams` to the `react`/`next/navigation` imports (line 3-4 currently `import { useEffect, useMemo, useRef, useState } from "react";` and `import { useRouter } from "next/navigation";`):

```tsx
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
```

2. Change `export default function ChatPage() {` (line 158) to `function ChatPageInner() {` (drop `export default`).
3. At the very end of the file, replace the final closing brace of the component with:

```tsx
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="h-[100dvh] bg-[var(--bg)]"><Navbar /></div>}>
      <ChatPageInner />
    </Suspense>
  );
}
```

- [ ] **Step 2: Add the `searchParams`-driven effect**

Inside `ChatPageInner`, right after the existing conversations hook block (after the `const meId = ...` / `const messages = ...` lines, i.e. right after line 227 `const messages = useMemo(...)`), add:

```tsx
  const searchParams = useSearchParams();

  // Abre (o crea) la conversación con el userid pasado por query string —
  // usado por el botón "Contactar Profesor" de /materia/[slug].
  useEffect(() => {
    const raw = searchParams.get("userid");
    if (!authed || !raw || convLoading) return;
    const uid = Number(raw);
    if (!uid) { router.replace("/chat"); return; }

    const existing = conversations.find((c) => c.contact.id === uid);
    if (existing) {
      setSelectedId(existing.id);
      router.replace("/chat");
      return;
    }

    fetch(`/api/userprofile?userid=${uid}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { name?: string } | null) => {
        if (p?.name) setPendingContact({ id: uid, name: p.name, avatarUrl: null });
      })
      .finally(() => router.replace("/chat"));
  }, [authed, convLoading, conversations, searchParams, router]);
```

- [ ] **Step 3: Typecheck**

Run: `cd "c:/Users/Asus/Desktop/Facultad/IP-Calculator/Campus/campus-utn" && npx tsc --noEmit`
Expected: no errors mentioning `app/chat/page.tsx`.

- [ ] **Step 4: Manual browser test — new contact**

Run: `cd "c:/Users/Asus/Desktop/Facultad/IP-Calculator/Campus/campus-utn" && npm run dev`
With a professor you have **no** existing conversation with (check `/chat`'s conversation list first to be sure), navigate directly to `http://localhost:3000/chat?userid={professorId}`.
Expected: the chat panel opens automatically in "Nuevo chat" mode with that professor's name in the header, the URL becomes `/chat` (query param stripped), and typing+sending a message creates the conversation.

- [ ] **Step 5: Manual browser test — existing contact**

Send a message once (from Step 4) so a real conversation now exists with that professor, then navigate again to `http://localhost:3000/chat?userid={professorId}`.
Expected: it opens that same existing conversation directly (not a second "Nuevo chat" state).

- [ ] **Step 6: Manual browser test — via the modal end-to-end**

From `/materia/[slug]`, click "Contactar Profesor" → click "Comunicarte" on a professor.
Expected: lands on `/chat` with that professor's conversation open (existing or new), matching Steps 4/5.

- [ ] **Step 7: Commit**

```bash
git add app/chat/page.tsx
git commit -m "feat: open chat conversation from ?userid= query param"
```

---

## Self-Review Notes

- **Spec coverage:** endpoint (Task 2), modal (Task 3), header button (Task 4), chat query-param handling (Task 5), parser isolated for testability (Task 1) — all four spec sections have a task. Guest mode is covered in Task 2 Step 1 (`isGuestRequest` → `{ professors: [] }`) and relies on chat's pre-existing `triggerGuestBlock()` for writes, as called out in the spec's scope section.
- **Placeholder scan:** no TBD/TODO; every step has literal code or a literal manual-check expectation.
- **Type consistency:** `Professor { id: number; name: string; avatarUrl: string | null }` is defined once in `lib/participants.ts` (Task 1) and reused verbatim by the route (Task 2) and the modal (Task 3) via `import type { Professor } from "@/lib/participants"` — no redefinition drift. `ContactProfessorModal` props (`courseId`, `open`, `onClose`) match exactly how Task 4 instantiates it.
