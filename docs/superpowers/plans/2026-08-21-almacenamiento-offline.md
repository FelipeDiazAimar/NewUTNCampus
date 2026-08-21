# Almacenamiento Offline (PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Campus UTN, when installed as a PWA, persist read data (materias, horarios, notas, agenda, secciones, notas/inasistencias de Sysacad) and opt-in files locally so they remain available offline, while every write action shows a "requires internet" modal instead of failing silently.

**Architecture:** A new Supabase table + API route stores per-user offline preferences (username-keyed, mirroring `perfil_notificaciones`). File bytes are cached client-side in IndexedDB (mirroring `lib/ocrCache.ts`), triggered from the existing file-viewer components. Read data and the app shell are cached via a `fetch` handler added to the existing `public/sw.js`. Write actions are gated by a new `isOffline()`/`triggerOfflineBlock()` pair that mirrors the already-established `isGuestMode()`/`triggerGuestBlock()` pattern, reusing the exact same ~15 call sites already gated for guest mode.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS v4 (iOS HIG hex literals, not color tokens), Supabase (REST via `supabaseFetch`, no ORM), browser IndexedDB, Service Worker (Cache API), `lucide-react` icons.

**Spec:** `docs/superpowers/specs/2026-08-21-almacenamiento-offline-design.md`

## Global Constraints

- No test suite is configured in this repo (`package.json` only has `dev`/`build`/`start`/`lint`). Every task's verification step uses `npm run lint`, `npx tsc --noEmit`, and/or a concrete manual browser check (DevTools Application/Network tabs) instead of an automated test runner.
- Styling: iOS HIG hex literals inline in JSX (`#007aff` accent, `var(--fg)`, `var(--surface)`, `var(--secondary)`, `var(--separator)`, `var(--surface2)`, `var(--accent-light)`) — never Tailwind color tokens. Match `app/configuracion/page.tsx` and `components/GuestBlockModal.tsx` conventions exactly.
- User identity for all new server code: `username` (fallback `userid`) parsed from the `moodle_user` cookie — copy the existing `getUserKey()` helper (see `app/api/sessions/route.ts:10-19`), do not invent a new identity scheme.
- Supabase access is 100% via `supabaseFetch` from `lib/supabase.ts` (`fetch` to PostgREST) — no ORM, no `@supabase/supabase-js`. All new DB helpers must be best-effort (try/catch, degrade silently) like `lib/deviceSessions.ts` and `lib/errorEvents.ts`.
- Client-side error reporting: reuse `reportClientError(severity, message, extra?)` from `lib/clientErrorReporter.ts` for every offline-storage failure. Never build a parallel error-reporting path.
- Write-action offline guard must mirror the exact existing guest-mode pattern (`lib/guest.ts`: `isGuestMode()` + `triggerGuestBlock()` + custom `window` event + `GuestBlockModal.tsx` mounted once in `app/layout.tsx`). Do not introduce a React hook or context for this — match the established idiom.
- This project runs on a customized Next.js — per `AGENTS.md`, check `node_modules/next/dist/docs/` before using any Next.js API you're not 100% sure is unchanged (especially anything Service-Worker- or `instrumentation-client.ts`-adjacent, which is non-standard).
- Never touch the existing `push`/`notificationclick` handlers in `public/sw.js` — only add new listeners alongside them.
- `/api/files`, `/api/auth`, `/api/offline-preferences`, `/api/errors`, `/api/admin/*` must never be cached by the Service Worker.

---

## Task 1: Offline preferences — DB table, server helper, API route

**Files:**
- Create: `scripts/offline-preferences.sql`
- Create: `lib/offlinePreferences.ts`
- Create: `app/api/offline-preferences/route.ts`

**Interfaces:**
- Produces: `getOfflinePreferences(userKey: string): Promise<{ filesEnabled: boolean; onboardingSeenAt: string | null }>`, `setOfflinePreferences(userKey: string, patch: { filesEnabled?: boolean; onboardingSeenAt?: string }): Promise<boolean>` from `lib/offlinePreferences.ts` — consumed by Task 5 (onboarding modal) and Task 6 (configuración toggle).
- Produces: `GET /api/offline-preferences` → `{ filesEnabled: boolean; onboardingSeen: boolean }`; `POST /api/offline-preferences` body `{ filesEnabled?: boolean; onboardingSeen?: boolean }` → `{ ok: true }`.

- [ ] **Step 1: Write the SQL migration**

```sql
-- scripts/offline-preferences.sql
-- Preferencias de almacenamiento offline (PWA) por usuario.
CREATE TABLE IF NOT EXISTS offline_preferences (
  username TEXT PRIMARY KEY,
  files_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_seen_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

- [ ] **Step 2: Run the migration against Supabase**

Run the SQL in the Supabase project's SQL editor (same manual process used for `scripts/notifications.sql`, `scripts/error-events.sql`). This is a one-time manual step — there is no migration runner in this repo.

- [ ] **Step 3: Write `lib/offlinePreferences.ts`**

```typescript
import { supabaseFetch } from "@/lib/supabase";

/**
 * Preferencias de almacenamiento offline (Supabase: `offline_preferences`),
 * una fila por usuario (username). Best-effort: si Supabase falla, degrada a
 * valores por defecto (todo desactivado) sin romper la UI.
 */

const TABLE = "offline_preferences";

export type OfflinePreferences = {
  filesEnabled: boolean;
  onboardingSeenAt: string | null;
};

const DEFAULTS: OfflinePreferences = { filesEnabled: false, onboardingSeenAt: null };

export async function getOfflinePreferences(username: string): Promise<OfflinePreferences> {
  try {
    const res = await supabaseFetch(
      `${TABLE}?username=eq.${encodeURIComponent(username)}&select=files_enabled,onboarding_seen_at`
    );
    if (!res.ok) return DEFAULTS;
    const rows = (await res.json()) as { files_enabled: boolean; onboarding_seen_at: string | null }[];
    if (!rows[0]) return DEFAULTS;
    return { filesEnabled: rows[0].files_enabled, onboardingSeenAt: rows[0].onboarding_seen_at };
  } catch {
    return DEFAULTS;
  }
}

export async function setOfflinePreferences(
  username: string,
  patch: { filesEnabled?: boolean; onboardingSeenAt?: string }
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { username, updated_at: new Date().toISOString() };
    if (patch.filesEnabled !== undefined) body.files_enabled = patch.filesEnabled;
    if (patch.onboardingSeenAt !== undefined) body.onboarding_seen_at = patch.onboardingSeenAt;

    const res = await supabaseFetch(`${TABLE}?on_conflict=username`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Write `app/api/offline-preferences/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getOfflinePreferences, setOfflinePreferences } from "@/lib/offlinePreferences";

export const runtime = "nodejs";

/** user_key del usuario actual (mismo criterio que el login: username || userid). */
function getUserKey(req: NextRequest): string | null {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return null;
  try {
    const u = JSON.parse(raw) as { userid?: number | string; username?: string };
    return u.username || (u.userid != null ? String(u.userid) : null);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const userKey = getUserKey(req);
  if (!userKey) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const prefs = await getOfflinePreferences(userKey);
  return NextResponse.json({ filesEnabled: prefs.filesEnabled, onboardingSeen: prefs.onboardingSeenAt !== null });
}

export async function POST(req: NextRequest) {
  const userKey = getUserKey(req);
  if (!userKey) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const patch: { filesEnabled?: boolean; onboardingSeenAt?: string } = {};
  if (typeof body?.filesEnabled === "boolean") patch.filesEnabled = body.filesEnabled;
  if (body?.onboardingSeen === true) patch.onboardingSeenAt = new Date().toISOString();

  const ok = await setOfflinePreferences(userKey, patch);
  if (!ok) return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors referencing the three new files.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 6: Manual verification**

Start `npm run dev`, log in, then in the browser console run:
```js
fetch("/api/offline-preferences").then(r => r.json()).then(console.log)
```
Expected: `{ filesEnabled: false, onboardingSeen: false }`. Then:
```js
fetch("/api/offline-preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filesEnabled: true, onboardingSeen: true }) }).then(r => r.json()).then(console.log)
```
Expected: `{ ok: true }`, and re-fetching `GET` now returns `{ filesEnabled: true, onboardingSeen: true }`. Confirm a row appeared in the Supabase `offline_preferences` table.

- [ ] **Step 7: Commit**

```bash
git add scripts/offline-preferences.sql lib/offlinePreferences.ts app/api/offline-preferences/route.ts
git commit -m "feat: add offline preferences table, helper and API route"
```

---

## Task 2: Offline file cache (IndexedDB) with quota handling

**Files:**
- Create: `lib/offlineFileCache.ts`

**Interfaces:**
- Consumes: `reportClientError` from `lib/clientErrorReporter.ts` (existing, signature `(severity: "critical"|"error"|"warning", message: string, extra?: { stack?: string | null }) => void`).
- Produces: `saveFile(key, blob, meta)`, `getFile(key): Promise<{ blob: Blob; meta: OfflineFileMeta } | null>`, `deleteFile(key)`, `deleteFilesByMateria(materiaId)`, `clearAll()`, `listFiles(): Promise<OfflineFileRecord[]>`, `getTotalSize(): Promise<number>`, `isStorageFull(): boolean` — all consumed by Task 4 (viewer integration) and Task 6 (configuración accordion).

- [ ] **Step 1: Write `lib/offlineFileCache.ts`**

```typescript
import { reportClientError } from "@/lib/clientErrorReporter";

export type OfflineFileMeta = {
  materiaId: string;
  materiaNombre: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  savedAt: string;
};

export type OfflineFileRecord = OfflineFileMeta & { key: string };

const DB_NAME = "campus-offline-files";
const STORE_NAME = "files";
const DB_VERSION = 1;

// Se activa tras el primer QuotaExceededError; corta más intentos de guardado
// automático por el resto de la sesión para no repetir escrituras que ya
// sabemos que van a fallar en cada archivo que el usuario abra.
let storageFull = false;

export function isStorageFull(): boolean {
  return storageFull;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "QuotaExceededError";
}

export async function saveFile(key: string, blob: Blob, meta: OfflineFileMeta): Promise<void> {
  if (typeof indexedDB === "undefined" || storageFull) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ key, blob, ...meta });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    if (isQuotaError(err)) {
      storageFull = true;
      reportClientError("warning", `offline-files: espacio insuficiente al guardar ${meta.materiaNombre}/${meta.fileName}`);
      return;
    }
    reportClientError("warning", `offline-files: fallo al guardar ${meta.materiaNombre}/${meta.fileName}`, {
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
  }
}

export async function getFile(key: string): Promise<{ blob: Blob; meta: OfflineFileMeta } | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const row = req.result as (OfflineFileMeta & { key: string; blob: Blob }) | undefined;
        if (!row) return resolve(null);
        const { blob, ...meta } = row;
        resolve({ blob, meta });
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    reportClientError("warning", `offline-files: fallo al leer ${key}`, {
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
    return null;
  }
}

export async function deleteFile(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    reportClientError("warning", `offline-files: fallo al borrar ${key}`, {
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
  }
}

export async function listFiles(): Promise<OfflineFileRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const rows = (req.result as (OfflineFileMeta & { key: string; blob: Blob })[]) ?? [];
        resolve(rows.map(({ blob: _blob, ...meta }) => meta));
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    reportClientError("warning", "offline-files: fallo al listar archivos guardados", {
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
    return [];
  }
}

export async function deleteFilesByMateria(materiaId: string): Promise<void> {
  const all = await listFiles();
  await Promise.all(all.filter((f) => f.materiaId === materiaId).map((f) => deleteFile(f.key)));
}

export async function clearAll(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    reportClientError("warning", "offline-files: fallo al borrar todos los archivos", {
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
  }
}

export async function getTotalSize(): Promise<number> {
  const all = await listFiles();
  return all.reduce((sum, f) => sum + f.sizeBytes, 0);
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/offlineFileCache.ts`.

- [ ] **Step 3: Manual verification**

In the browser console (any page, logged in):
```js
const { saveFile, getFile, listFiles, getTotalSize, deleteFile } = await import("/lib/offlineFileCache.ts");
```
This import-in-console trick doesn't work directly in Next.js dev — instead verify via a temporary call from a React component during Task 4/6 testing. For this task alone, confirm via DevTools → Application → IndexedDB that opening any page that imports this module (once wired in Task 4) creates a `campus-offline-files` database with a `files` store.

- [ ] **Step 4: Commit**

```bash
git add lib/offlineFileCache.ts
git commit -m "feat: add IndexedDB offline file cache with quota handling"
```

---

## Task 3: Offline write-guard (mirrors guest-mode block pattern)

**Files:**
- Create: `lib/offline.ts`
- Create: `components/OfflineBlockModal.tsx`
- Modify: `app/layout.tsx` (mount `OfflineBlockModal`)
- Modify (add `if (isOffline()) { triggerOfflineBlock(); return; }` guard, same line as each existing guest check):
  - `components/AssignmentViewer.tsx:223`
  - `components/campus/CampusView.tsx:158-159`
  - `components/horarios/CustomEventModal.tsx:37`
  - `app/asistencia/page.tsx:361-362` and `:446`
  - `app/foro/_components/ForoClient.tsx:624,645,674,687`
  - `app/dashboard/sysacad/password/page.tsx:26`
  - `app/biblioteca/page.tsx:255,274`
  - `app/sysacad/inscripcion/page.tsx:140,191`
  - `app/chat/page.tsx:330`
  - `app/dashboard/horarios/page.tsx:243`

**Interfaces:**
- Produces: `isOffline(): boolean`, `triggerOfflineBlock(): void` from `lib/offline.ts` — consumed by every call site listed above and by Task 6/7 if needed.

- [ ] **Step 1: Write `lib/offline.ts`**

```typescript
/**
 * Bloqueo de acciones de escritura sin conexión — mismo patrón que
 * lib/guest.ts (isGuestMode/triggerGuestBlock), aplicado a los mismos ~15
 * call sites ya gateados para modo invitado, porque son exactamente las
 * mismas acciones (escrituras que necesitan red real).
 */

export function isOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false;
}

/** Dispara el popup de "esta acción necesita conexión a internet". */
export function triggerOfflineBlock(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("campus:offlineblock"));
  }
}
```

- [ ] **Step 2: Write `components/OfflineBlockModal.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { WifiOff, X } from "lucide-react";

/**
 * Modal global que aparece cuando una acción de escritura se intenta sin
 * conexión. Escucha el evento custom "campus:offlineblock" emitido por
 * triggerOfflineBlock() desde cualquier componente.
 *
 * Agrega <OfflineBlockModal /> una sola vez en el root layout, junto a
 * <GuestBlockModal />.
 */
export default function OfflineBlockModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("campus:offlineblock", handler);
    return () => window.removeEventListener("campus:offlineblock", handler);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Acción no disponible sin conexión"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-sm bg-[var(--surface)] rounded-3xl shadow-2xl border border-[var(--separator)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 p-1.5 rounded-full text-[var(--secondary)] hover:bg-[var(--surface2)] transition-colors"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 pt-7 pb-6 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-[rgba(255,149,0,0.12)] flex items-center justify-center mb-1">
            <WifiOff className="w-7 h-7 text-[#ff9500]" />
          </div>

          <h2 className="text-[17px] font-semibold text-[var(--fg)]">
            Necesitás conexión a internet
          </h2>
          <p className="text-[14px] text-[var(--secondary)] leading-snug">
            Esta acción no está disponible sin conexión. Conectate a internet
            para poder continuar.
          </p>
        </div>

        <div className="px-4 pb-5">
          <button
            onClick={() => setOpen(false)}
            className="w-full py-3 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 transition-opacity"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount the modal in the root layout**

In `app/layout.tsx`, find the existing import and mount of `GuestBlockModal`:
```tsx
import GuestBlockModal from "@/components/GuestBlockModal";
```
Add directly below it:
```tsx
import OfflineBlockModal from "@/components/OfflineBlockModal";
```
Find:
```tsx
            {children}
            <GuestBlockModal />
```
Replace with:
```tsx
            {children}
            <GuestBlockModal />
            <OfflineBlockModal />
```

- [ ] **Step 4: Add the offline guard to `app/sysacad/inscripcion/page.tsx`**

Add the import next to the existing guest import:
```typescript
import { isGuestMode, triggerGuestBlock } from "@/lib/guest";
import { isOffline, triggerOfflineBlock } from "@/lib/offline";
```
Find (line 140):
```typescript
  async function handleInscribir(materia: SysacadMateriaParaCursado, comision: string) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
```
Replace with:
```typescript
  async function handleInscribir(materia: SysacadMateriaParaCursado, comision: string) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
    if (isOffline()) { triggerOfflineBlock(); return; }
```
Find (line 191):
```typescript
  async function handleDesinscribir(materia: SysacadMateriaParaCursado) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
```
Replace with:
```typescript
  async function handleDesinscribir(materia: SysacadMateriaParaCursado) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
    if (isOffline()) { triggerOfflineBlock(); return; }
```

- [ ] **Step 5: Add the offline guard to `app/dashboard/sysacad/password/page.tsx`**

Add the import next to the existing guest import:
```typescript
import { isGuestMode, triggerGuestBlock } from "@/lib/guest";
import { isOffline, triggerOfflineBlock } from "@/lib/offline";
```
Find (line 26):
```typescript
    if (isGuestMode()) { triggerGuestBlock(); return; }
```
Replace with:
```typescript
    if (isGuestMode()) { triggerGuestBlock(); return; }
    if (isOffline()) { triggerOfflineBlock(); return; }
```

- [ ] **Step 6: Add the offline guard to the remaining call sites**

Repeat the same two-line pattern (import `isOffline, triggerOfflineBlock` from `@/lib/offline` next to the existing `lib/guest` import; insert `if (isOffline()) { triggerOfflineBlock(); return; }` immediately after every existing `if (isGuestMode()) { triggerGuestBlock(); return; }` line, or after the equivalent multi-line guest check) in:
- `components/AssignmentViewer.tsx` (around line 223, inside `handleUpload`)
- `components/campus/CampusView.tsx` (around lines 158-159)
- `components/horarios/CustomEventModal.tsx` (around line 37)
- `app/asistencia/page.tsx` (around lines 361-362 and 446 — the second site is an inline `onClick={() => triggerGuestBlock()}`; change it to `onClick={() => { isOffline() ? triggerOfflineBlock() : triggerGuestBlock(); }}` only if that call site isn't already behind an `isGuestMode()` check — inspect the surrounding code first and match its existing structure)
- `app/foro/_components/ForoClient.tsx` (4 sites: `publish`, `toggleLikePost`, `addReply`, `toggleLikeReply`)
- `app/biblioteca/page.tsx` (2 sites: `saveProfile` and the form submit handler)
- `app/chat/page.tsx` (around line 330, inside `send`)
- `app/dashboard/horarios/page.tsx` (around line 243, inside `deleteEvent`)

For each file, read the surrounding function first to confirm the exact existing guest-check shape before inserting — some are single-line (`if (isGuestMode()) { triggerGuestBlock(); return; }`), the CampusView one spans two lines. Match whichever shape is present.

- [ ] **Step 7: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 8: Manual verification**

Start `npm run dev`, log in (not guest mode), open DevTools → Network → set throttling to "Offline". Go to `/sysacad/inscripcion` and click "Inscribirse" on any materia. Expected: the "Necesitás conexión a internet" modal appears instead of a failed network request. Repeat for `/dashboard/sysacad/password` (submit the password change form). Set throttling back to "Online" before continuing.

- [ ] **Step 9: Commit**

```bash
git add lib/offline.ts components/OfflineBlockModal.tsx app/layout.tsx components/AssignmentViewer.tsx components/campus/CampusView.tsx components/horarios/CustomEventModal.tsx app/asistencia/page.tsx app/foro/_components/ForoClient.tsx app/dashboard/sysacad/password/page.tsx app/biblioteca/page.tsx app/sysacad/inscripcion/page.tsx app/chat/page.tsx app/dashboard/horarios/page.tsx
git commit -m "feat: block write actions offline, mirroring the guest-mode block pattern"
```

---

## Task 4: Wire automatic file saving into the file viewers

**Files:**
- Modify: `components/CourseFileViewer.tsx`
- Modify: `components/FolderViewer.tsx`

**Interfaces:**
- Consumes: `saveFile`, `getFile` from `lib/offlineFileCache.ts` (Task 2); `GET /api/offline-preferences` (Task 1) to read `filesEnabled`.

- [ ] **Step 1: Add a shared preferences reader**

At the top of `components/CourseFileViewer.tsx`, add:
```typescript
import { getFile, saveFile } from "@/lib/offlineFileCache";

let filesEnabledCache: boolean | null = null;
async function filesEnabled(): Promise<boolean> {
  if (filesEnabledCache !== null) return filesEnabledCache;
  try {
    const r = await fetch("/api/offline-preferences");
    if (!r.ok) return false;
    const j = await r.json();
    filesEnabledCache = j.filesEnabled === true;
    return filesEnabledCache;
  } catch {
    return false;
  }
}
```
This module-level cache avoids refetching the preference on every file click within a session; it's intentionally simple (no invalidation) since the toggle only changes from `/configuracion`, a full page navigation away.

- [ ] **Step 2: Save the file in the background after a successful open, and fall back to the offline copy on failure**

In `components/CourseFileViewer.tsx`, inside `FileViewer`, find the `handleClick` callback's kind-detection block (around where `PANEL_KINDS.includes(kind)` opens the panel). Before the `if (PANEL_KINDS.includes(kind))` line, add a background-save call. Also add a materia-context prop so the cache key can group by materia — extend the component's props:

Find:
```typescript
export function FileViewer({ content }: { content: MoodleContent }) {
```
Replace with:
```typescript
export function FileViewer({
  content,
  materiaId,
  materiaNombre,
}: {
  content: MoodleContent;
  materiaId?: string;
  materiaNombre?: string;
}) {
```

Find, inside `handleClick`, the block:
```typescript
    // Document kinds → open in right panel
    if (PANEL_KINDS.includes(kind)) {
```
Replace with:
```typescript
    // Guardado offline en background — no bloquea la apertura del archivo.
    if (materiaId && (await filesEnabled())) {
      fetch(proxyUrl)
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (!blob) return;
          saveFile(content.fileurl!, blob, {
            materiaId,
            materiaNombre: materiaNombre ?? "Sin materia",
            fileName,
            mimeType: blob.type || "application/octet-stream",
            sizeBytes: blob.size,
            savedAt: new Date().toISOString(),
          });
        })
        .catch(() => { /* silencioso — el fetch principal del visor ya maneja errores */ });
    }

    // Document kinds → open in right panel
    if (PANEL_KINDS.includes(kind)) {
```

Note: `content.fileurl` is used as the cache key (matches the spec: "the same opaque `ref` already used by `/api/files?ref=...`").

- [ ] **Step 3: Serve the offline copy when the network is unavailable**

Still inside `handleClick`, the kind-detection `try`/`catch` around `/api/meta` already handles network failure for *detecting* the kind. The panel itself (`openPanel`) passes `proxyUrl` down to the PDF/DOCX/XLSX viewers, which do their own fetching — those are out of scope for this plan (per the design's "Fuera de esta spec" list, only the automatic save/lookup at the `FileViewer` row level is required). Add an offline-aware fallback only for the "download" affordance, since that's a direct, single fetch this component controls: modify `handleSaveAs`.

Find:
```typescript
  const handleSaveAs = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      const picker = (window as Window & { showSaveFilePicker?: (o: object) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }> }).showSaveFilePicker;
      if (!picker) throw new Error("not supported");
      const handle = await picker({ suggestedName: fileName, types: [{ description: "Archivo" }] });
      const res = await fetch(downloadUrl);
      const blob = await res.blob();
```
Replace with:
```typescript
  const handleSaveAs = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      const picker = (window as Window & { showSaveFilePicker?: (o: object) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }> }).showSaveFilePicker;
      if (!picker) throw new Error("not supported");
      const handle = await picker({ suggestedName: fileName, types: [{ description: "Archivo" }] });
      let blob: Blob;
      try {
        const res = await fetch(downloadUrl);
        blob = await res.blob();
      } catch (networkErr) {
        const offline = await getFile(content.fileurl!);
        if (!offline) throw networkErr;
        blob = offline.blob;
      }
```
And remove the now-duplicate `const blob = await res.blob();` line that follows (keep only the new block above it).

- [ ] **Step 4: Pass `materiaId`/`materiaNombre` from callers**

`FileViewer` is used from course pages (search for other usages beyond `FolderViewer.tsx`) — find every JSX call site with:
```
grep -rn "<FileViewer" --include=*.tsx
```
For each call site inside a course/materia context, add `materiaId={course.id.toString()} materiaNombre={course.fullname}` (adjust variable names to whatever's in scope at that call site — read the surrounding component to find the course object in scope). For `components/FolderViewer.tsx`'s `FileNodeRow`, do the same: thread `materiaId`/`materiaNombre` as new props down from `FolderViewer`'s own props (`mod: MoodleModule` doesn't carry course info today — add `materiaId?: string; materiaNombre?: string` to `FolderViewer`'s props, forward them through `FileNodeRow`/`SubfolderRow` to `FileViewer`), and update `FolderViewer`'s own call sites the same way.

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc --noEmit`
Expected: no errors — this step will surface any call site missed in Step 4 only if `materiaId`/`materiaNombre` were made required; since they're optional (`?:`), missed call sites won't error but will simply not cache. Explicitly re-run the grep from Step 4 and confirm every course-context call site was updated.

- [ ] **Step 6: Manual verification**

With `files_enabled: true` (set via the console command from Task 1 Step 6), open a course, click a PDF to preview it. In DevTools → Application → IndexedDB → `campus-offline-files` → `files`, confirm a new row appeared with the correct `materiaNombre`/`fileName`. Then set Network throttling to "Offline", reload the page, click "Guardar como…" on the same file (or use a browser that supports `showSaveFilePicker`) — confirm the file saves from the offline copy without a network error.

- [ ] **Step 7: Commit**

```bash
git add components/CourseFileViewer.tsx components/FolderViewer.tsx
git commit -m "feat: save opened files to IndexedDB when offline storage is enabled"
```

---

## Task 5: Onboarding modal (PWA-only, first visit to /materias)

**Files:**
- Create: `components/OfflineOnboardingModal.tsx`
- Modify: `app/materias/page.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/offline-preferences` (Task 1).

- [ ] **Step 1: Use the frontend-design skill for this component**

Before writing `OfflineOnboardingModal.tsx`, invoke the `frontend-design` skill to get the exact visual treatment (spacing, iconography, copy tone) consistent with `components/GuestBlockModal.tsx` and `components/OfflineBlockModal.tsx` (Task 3) as reference points. The component must:
- Detect PWA mode via `window.matchMedia('(display-mode: standalone)').matches` with `navigator.standalone` as an iOS fallback.
- Render nothing (`return null`) when not in PWA mode, or when `onboardingSeen` is already `true`.
- Be centered and fixed in the viewport (same `fixed inset-0` overlay pattern as the two modals above), sized for mobile.
- Offer two actions: "Activar" (→ `POST { filesEnabled: true, onboardingSeen: true }`) and "Ahora no" (→ `POST { filesEnabled: false, onboardingSeen: true }`).
- Explain that materias/horarios/notas/agenda are saved automatically regardless of the choice, and that this toggle is specifically about files.

- [ ] **Step 2: Implement `components/OfflineOnboardingModal.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

function isPwaStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

export default function OfflineOnboardingModal() {
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isPwaStandalone()) return;
    fetch("/api/offline-preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.onboardingSeen === false) setVisible(true); })
      .catch(() => { /* no molestar si falla — se puede activar luego desde /configuracion */ });
  }, []);

  async function choose(filesEnabled: boolean) {
    setSaving(true);
    try {
      await fetch("/api/offline-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filesEnabled, onboardingSeen: true }),
      });
    } finally {
      setSaving(false);
      setVisible(false);
    }
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Guardado offline"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div className="relative w-full max-w-sm bg-[var(--surface)] rounded-3xl shadow-2xl border border-[var(--separator)] overflow-hidden">
        <button
          onClick={() => choose(false)}
          disabled={saving}
          className="absolute top-3 right-3 p-1.5 rounded-full text-[var(--secondary)] hover:bg-[var(--surface2)] transition-colors disabled:opacity-40"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 pt-7 pb-6 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-[rgba(0,122,255,0.1)] flex items-center justify-center mb-1">
            <Download className="w-7 h-7 text-[#007aff]" />
          </div>

          <h2 className="text-[17px] font-semibold text-[var(--fg)]">
            Campus UTN sin conexión
          </h2>
          <p className="text-[14px] text-[var(--secondary)] leading-snug">
            Tus materias, horarios, notas y agenda se guardan automáticamente
            para que los veas sin internet. ¿Querés además guardar los
            archivos que abras, para verlos offline?
          </p>
        </div>

        <div className="px-4 pb-5 flex flex-col gap-2">
          <button
            onClick={() => choose(true)}
            disabled={saving}
            className="w-full py-3 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 transition-opacity disabled:opacity-60"
          >
            Activar
          </button>
          <button
            onClick={() => choose(false)}
            disabled={saving}
            className="w-full py-2.5 rounded-2xl text-[#007aff] font-medium text-[14px] active:opacity-70 disabled:opacity-60"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount it in `/materias`**

In `app/materias/page.tsx`, add the import:
```tsx
import OfflineOnboardingModal from "@/components/OfflineOnboardingModal";
```
Find:
```tsx
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar fullname={userInfo.fullname} />
```
Replace with:
```tsx
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar fullname={userInfo.fullname} />
      <OfflineOnboardingModal />
```

- [ ] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

This can't be fully verified in a normal browser tab (PWA standalone mode). Options: (a) install the app as a PWA locally (Chrome → "Install app") and open `/materias` there, or (b) temporarily hardcode `isPwaStandalone` to return `true` while testing, then revert. Confirm: modal appears once, "Activar" sets `filesEnabled: true` (verify via `GET /api/offline-preferences`), reloading `/materias` never shows it again. Revert any temporary hardcoding before committing.

- [ ] **Step 6: Commit**

```bash
git add components/OfflineOnboardingModal.tsx app/materias/page.tsx
git commit -m "feat: add PWA-only offline storage onboarding modal on /materias"
```

---

## Task 6: "Almacenamiento offline" section in /configuracion

**Files:**
- Create: `components/OfflineStorageSection.tsx`
- Modify: `app/configuracion/page.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/offline-preferences` (Task 1); `listFiles`, `getTotalSize`, `deleteFile`, `deleteFilesByMateria`, `clearAll`, `isStorageFull` from `lib/offlineFileCache.ts` (Task 2).

- [ ] **Step 1: Use the frontend-design skill for the file-type icon palette**

Before implementing, invoke `frontend-design` to pick the exact per-type icon + background-color pairs (PDF, DOCX, XLSX, PPTX, other) consistent with the existing `ICON_COLORS` palette used in `app/materias/page.tsx:79-86` and the folder icon styling in `components/FolderViewer.tsx:64` (`background: "#fff3e0", color: "#ff9500"` for folders). Reuse `lucide-react`'s `FileText`, `FileSpreadsheet`, `Presentation`, `File` icons or inline SVGs matching the existing style (2.2 stroke width, round caps, as seen throughout `CourseFileViewer.tsx`).

- [ ] **Step 2: Implement `components/OfflineStorageSection.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSpreadsheet, FileText, Presentation, File as FileIcon, Trash2 } from "lucide-react";
import {
  clearAll,
  deleteFile,
  deleteFilesByMateria,
  getTotalSize,
  isStorageFull,
  listFiles,
  type OfflineFileRecord,
} from "@/lib/offlineFileCache";
import { formatBytes } from "@/components/CourseFileViewer";

type TypeStyle = { Icon: typeof FileText; bg: string; fg: string };

function typeStyle(mimeType: string, fileName: string): TypeStyle {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType.includes("pdf") || ext === "pdf") return { Icon: FileText, bg: "#ffe8e7", fg: "#ff3b30" };
  if (mimeType.includes("wordprocessingml") || mimeType.includes("msword") || ext === "docx")
    return { Icon: FileText, bg: "#e8f4fd", fg: "#007aff" };
  if (mimeType.includes("spreadsheetml") || mimeType.includes("ms-excel") || ["xlsx", "xls", "csv"].includes(ext))
    return { Icon: FileSpreadsheet, bg: "#e8f8ed", fg: "#34c759" };
  if (mimeType.includes("presentationml") || mimeType.includes("mspowerpoint") || ext === "pptx")
    return { Icon: Presentation, bg: "#fff3e0", fg: "#ff9500" };
  return { Icon: FileIcon, bg: "var(--surface2)", fg: "var(--secondary)" };
}

function groupByMateria(files: OfflineFileRecord[]): [string, string, OfflineFileRecord[]][] {
  const map = new Map<string, { nombre: string; files: OfflineFileRecord[] }>();
  for (const f of files) {
    if (!map.has(f.materiaId)) map.set(f.materiaId, { nombre: f.materiaNombre, files: [] });
    map.get(f.materiaId)!.files.push(f);
  }
  return [...map.entries()].map(([id, { nombre, files: fs }]) => [
    id,
    nombre,
    [...fs].sort((a, b) => b.sizeBytes - a.sizeBytes),
  ]);
}

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));

export default function OfflineStorageSection() {
  const [filesEnabled, setFilesEnabled] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [files, setFiles] = useState<OfflineFileRecord[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [openMateria, setOpenMateria] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshFiles = useCallback(async () => {
    const [list, size] = await Promise.all([listFiles(), getTotalSize()]);
    setFiles(list);
    setTotalSize(size);
  }, []);

  useEffect(() => {
    fetcher("/api/offline-preferences").then((j) => {
      if (j) setFilesEnabled(j.filesEnabled === true);
      setLoadingPrefs(false);
    });
    refreshFiles();
  }, [refreshFiles]);

  async function toggle() {
    const next = !filesEnabled;
    setFilesEnabled(next);
    await fetch("/api/offline-preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filesEnabled: next }),
    }).catch(() => {});
  }

  async function removeFile(key: string) {
    setBusy(true);
    await deleteFile(key);
    await refreshFiles();
    setBusy(false);
  }

  async function removeMateria(materiaId: string) {
    setBusy(true);
    await deleteFilesByMateria(materiaId);
    await refreshFiles();
    setBusy(false);
  }

  async function removeAll() {
    setBusy(true);
    await clearAll();
    await refreshFiles();
    setBusy(false);
  }

  const groups = groupByMateria(files);

  return (
    <section className="mb-7">
      <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
        Almacenamiento offline
      </p>

      <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm">
        <button
          type="button"
          onClick={toggle}
          disabled={loadingPrefs}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-black/5 dark:active:bg-white/5 disabled:opacity-60"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium text-[var(--fg)]">Guardar archivos para uso offline</span>
            <span className="block text-[12px] text-[var(--secondary)]">
              Guarda automáticamente los archivos que abrís para verlos sin internet
            </span>
          </span>
          <span
            className={`relative shrink-0 w-11 h-6.5 rounded-full transition-colors ${filesEnabled ? "bg-[#34c759]" : "bg-[var(--surface2)]"}`}
            style={{ height: "26px" }}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${filesEnabled ? "translate-x-[18px]" : ""}`}
            />
          </span>
        </button>

        <div className="px-4 py-3 border-t border-[var(--separator)]">
          <p className="text-[13px] text-[var(--secondary)]">
            Espacio usado: <span className="font-medium text-[var(--fg)]">{formatBytes(totalSize) || "0 B"}</span>
          </p>
          {isStorageFull() && (
            <p className="mt-1 text-[12px] text-[#ff9500]">
              Espacio insuficiente en el dispositivo — borrá algunos archivos para seguir guardando offline.
            </p>
          )}
        </div>
      </div>

      {groups.length > 0 && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={removeAll}
            className="mt-3 w-full rounded-[14px] border border-[rgba(255,59,48,0.3)] bg-[var(--surface)] py-3 text-[14px] font-semibold text-[#ff3b30] shadow-sm transition-opacity active:opacity-80 disabled:opacity-40"
          >
            Borrar todo
          </button>

          <div className="mt-3 overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm divide-y divide-[var(--separator)]">
            {groups.map(([materiaId, materiaNombre, list]) => {
              const open = openMateria === materiaId;
              return (
                <div key={materiaId}>
                  <button
                    type="button"
                    onClick={() => setOpenMateria(open ? null : materiaId)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <span className="flex-1 min-w-0 text-[14px] font-medium text-[var(--fg)] truncate">{materiaNombre}</span>
                    <span className="text-[12px] text-[var(--secondary)]">{list.length}</span>
                  </button>
                  {open && (
                    <div className="divide-y divide-[rgba(60,60,67,0.06)] bg-[var(--surface2)]">
                      {list.map((f) => {
                        const { Icon, bg, fg } = typeStyle(f.mimeType, f.fileName);
                        return (
                          <div key={f.key} className="flex items-center gap-3 px-4 py-2.5">
                            <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: bg, color: fg }}>
                              <Icon className="w-4 h-4" />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[13px] text-[var(--fg)] truncate">{f.fileName}</span>
                              <span className="block text-[11px] text-[var(--secondary)]">{formatBytes(f.sizeBytes)}</span>
                            </span>
                            <button
                              disabled={busy}
                              onClick={() => removeFile(f.key)}
                              className="shrink-0 text-[var(--secondary)] hover:text-[#ff3b30] transition-colors disabled:opacity-40"
                              aria-label={`Borrar ${f.fileName}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                      <div className="px-4 py-2.5">
                        <button
                          disabled={busy}
                          onClick={() => removeMateria(materiaId)}
                          className="text-[12px] font-semibold text-[#ff3b30] disabled:opacity-40"
                        >
                          Borrar todos los apuntes de esta materia
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
```

Note: `formatBytes` is imported from `components/CourseFileViewer.tsx` where it's already exported (see that file's line 9) — do not duplicate it.

- [ ] **Step 3: Mount it in `/configuracion`**

In `app/configuracion/page.tsx`, add the import:
```tsx
import OfflineStorageSection from "@/components/OfflineStorageSection";
```
Find:
```tsx
        {/* ── Próximamente ── */}
        <Section title="Más opciones">
```
Replace with:
```tsx
        <OfflineStorageSection />

        {/* ── Próximamente ── */}
        <Section title="Más opciones">
```

- [ ] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Open `/configuracion`, confirm the "Almacenamiento offline" section renders between "Sesiones en otros dispositivos" and "Más opciones", toggle switches and persists (reload the page, confirm state survives). After Task 4 has saved at least one file, confirm it appears grouped by materia, sorted by size descending, with the correct colored icon by type. Delete a single file and confirm the row disappears and "Espacio usado" updates. Test "Borrar todos los apuntes de esta materia" and "Borrar todo".

- [ ] **Step 6: Commit**

```bash
git add components/OfflineStorageSection.tsx app/configuracion/page.tsx
git commit -m "feat: add offline storage toggle and downloaded-files accordion to /configuracion"
```

---

## Task 7: "Modo Offline" header chip

**Files:**
- Create: `components/OfflineStatusChip.tsx`
- Modify: `components/Navbar.tsx`

**Interfaces:**
- No new consumed interfaces beyond browser `online`/`offline` events.

- [ ] **Step 1: Implement `components/OfflineStatusChip.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

export default function OfflineStatusChip() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <span className="flex items-center gap-1.5 rounded-full bg-[rgba(52,199,89,0.14)] px-2.5 py-1 text-[12px] font-semibold text-[#248a3d] dark:text-[#34c759]">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34c759] opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34c759]" />
      </span>
      Modo Offline
    </span>
  );
}
```

- [ ] **Step 2: Mount it in `Navbar.tsx`**

In `components/Navbar.tsx`, add the import:
```tsx
import OfflineStatusChip from "./OfflineStatusChip";
```
Find:
```tsx
          {/* Right actions */}
          <div className="flex items-center gap-2 shrink-0">
            {fullname && !isGuest && (
```
Replace with:
```tsx
          {/* Right actions */}
          <div className="flex items-center gap-2 shrink-0">
            <OfflineStatusChip />
            {fullname && !isGuest && (
```

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

In any logged-in page, open DevTools → Network → set throttling to "Offline". Expected: green "Modo Offline" chip with a pulsing dot appears in the header within ~1s. Set throttling back to "Online": chip disappears immediately (via the `online` event).

- [ ] **Step 5: Commit**

```bash
git add components/OfflineStatusChip.tsx components/Navbar.tsx
git commit -m "feat: show a pulsing green Modo Offline chip in the header when offline"
```

---

## Task 8: Extend the Service Worker with offline data caching

**Files:**
- Modify: `public/sw.js`
- Create: `app/offline/page.tsx`

**Interfaces:**
- No TypeScript interfaces — `public/sw.js` is a plain JS file that runs outside the Next.js module graph.

- [ ] **Step 1: Create the offline fallback page**

```tsx
// app/offline/page.tsx
export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-6">
      <div className="text-center max-w-xs">
        <h1 className="text-[20px] font-semibold text-[var(--fg)] mb-2">Sin conexión</h1>
        <p className="text-[14px] text-[var(--secondary)]">
          Esta página todavía no se guardó para verse sin internet. Conectate y volvé a intentar.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the fetch handler to `public/sw.js`**

Append to the end of the existing file (after the `notificationclick` listener, do not remove or reorder the existing `push`/`notificationclick` listeners):

```javascript
// ─── Offline data & app-shell caching ──────────────────────────────────────
// Extiende este Service Worker (que ya maneja Web Push arriba) con un
// handler de fetch para guardar materias/horarios/notas/agenda y navegación
// ya visitada, disponibles sin conexión. Nunca cachea /api/files (streaming
// con Range, cubierto aparte por IndexedDB en el cliente), /api/auth,
// /api/offline-preferences, /api/errors ni /api/admin/*.

const RUNTIME_CACHE = "campus-runtime-v1";
const OFFLINE_FALLBACK_URL = "/offline";

const NEVER_CACHE_PATTERNS = [
  /^\/api\/files/,
  /^\/api\/auth/,
  /^\/api\/offline-preferences/,
  /^\/api\/errors/,
  /^\/api\/admin/,
];

function shouldNeverCache(pathname) {
  return NEVER_CACHE_PATTERNS.some((re) => re.test(pathname));
}

async function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// /api/moodle solo acepta POST { methodname, args } — para poder cachearlo
// con Cache API (que solo indexa por Request/URL) armamos una URL sintética
// GET a partir del cuerpo, estable entre llamadas idénticas.
async function moodleCacheKey(request) {
  const body = await request.clone().json().catch(() => null);
  if (!body) return null;
  const key = await stableStringify({ m: body.methodname, a: body.args });
  return new Request(`${self.location.origin}/__sw_moodle_cache__?k=${encodeURIComponent(key)}`);
}

// El SW no tiene acceso a reportClientError (vive en el hilo principal) —
// se avisa a los clientes abiertos vía postMessage; instrumentation-client.ts
// escucha "message" en el SW y reenvía al reporter real.
async function notifyClientsOfCacheFailure(context, err) {
  const clientsList = await self.clients.matchAll({ type: "window" });
  for (const client of clientsList) {
    client.postMessage({ type: "campus:sw-cache-error", context, message: err && err.message });
  }
}

async function safeCachePut(cache, key, response) {
  try {
    await cache.put(key, response);
  } catch (err) {
    // Típicamente QuotaExceededError — no debe romper la respuesta al usuario.
    notifyClientsOfCacheFailure("runtime-cache-put", err);
  }
}

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) safeCachePut(cache, cacheKey ?? request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(cacheKey ?? request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallback = await cache.match(OFFLINE_FALLBACK_URL);
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) safeCachePut(cache, request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.headers.has("Range")) return; // nunca — cubierto por IndexedDB en el cliente
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (shouldNeverCache(url.pathname)) return;

  // Caso especial: POST /api/moodle — la vía principal de datos de materias.
  if (request.method === "POST" && url.pathname === "/api/moodle") {
    event.respondWith(
      (async () => {
        const cacheKey = await moodleCacheKey(request);
        if (!cacheKey) return fetch(request);
        return networkFirst(request, cacheKey);
      })()
    );
    return;
  }

  if (request.method !== "GET") return; // otras escrituras: siempre red, nunca cache

  if (url.pathname.startsWith("/_next/static/") || /\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate" || url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
  }
});
```

- [ ] **Step 3: Verify the offline page builds**

Run: `npm run build`
Expected: build succeeds, `/offline` appears in the route output.

- [ ] **Step 4: Manual verification**

Start `npm run dev`, register the Service Worker (visit `/notificaciones` once so it registers, or wait for Task 9 to make it global), then visit `/materias` while online (populates the cache). Open DevTools → Application → Service Workers, confirm the SW is "activated and running". Open DevTools → Application → Cache Storage → `campus-runtime-v1`, confirm entries exist for `/materias` and the `/api/moodle` synthetic key. Set Network throttling to "Offline", reload `/materias` — expected: page loads from cache instead of showing the browser's native offline error. Visit a never-before-seen route while offline (e.g. a course you haven't opened) — expected: falls back to `/offline`.

- [ ] **Step 5: Commit**

```bash
git add public/sw.js app/offline/page.tsx
git commit -m "feat: cache app data and navigation in the Service Worker for offline access"
```

---

## Task 9: Register the Service Worker globally

**Files:**
- Modify: `instrumentation-client.ts`

**Interfaces:**
- No new interfaces — registers the SW extended in Task 8 app-wide instead of only from `/notificaciones`.

- [ ] **Step 1: Add global SW registration**

Find:
```typescript
import { initClientErrorTracking } from "@/lib/clientErrorReporter";

initClientErrorTracking();
```
Replace with:
```typescript
import { initClientErrorTracking } from "@/lib/clientErrorReporter";
import { reportClientError } from "@/lib/clientErrorReporter";

initClientErrorTracking();

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .catch((err) => {
      reportClientError("warning", `Registro del Service Worker falló: ${(err as Error).message}`);
    });

  // El SW no tiene acceso directo a reportClientError (hilo aparte) — reenvía
  // acá los fallos de cacheo que reporta vía postMessage (ver public/sw.js).
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "campus:sw-cache-error") return;
    reportClientError("warning", `offline-cache (SW): ${event.data.context} — ${event.data.message ?? "error desconocido"}`);
  });
}
```

- [ ] **Step 2: Remove the now-redundant registration in `/notificaciones`**

Read `app/notificaciones/page.tsx` around lines 103-138 (the existing `navigator.serviceWorker.register("/sw.js", ...)` call for push). Since registration is now global and idempotent (calling `register()` again with the same script/scope returns the existing registration per the Service Worker spec), leave that call in place — it's harmless and Push-specific logic downstream (subscribing) still needs to run from that page. Do not remove it; just confirm (via the manual test below) that having both doesn't cause double SW instances.

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Clear any existing Service Worker registration (DevTools → Application → Service Workers → Unregister). Reload `/dashboard` (not `/notificaciones`). Expected: DevTools → Application → Service Workers shows the SW registered and activated, without ever visiting `/notificaciones`. Confirm Web Push still works by visiting `/notificaciones` and checking a subscription can still be created (existing behavior, must not regress).

- [ ] **Step 5: Commit**

```bash
git add instrumentation-client.ts
git commit -m "feat: register the Service Worker app-wide instead of only from /notificaciones"
```

---

## Task 10: End-to-end verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: succeeds with no type or lint errors across all files touched in Tasks 1-9.

- [ ] **Step 2: Cold offline walkthrough**

With the app installed as a PWA (or a normal tab with the SW registered and `/materias`, `/dashboard`, one course, and `/sysacad` already visited once online): set Network throttling to "Offline" (or actual airplane mode on a phone) and confirm, per the spec's summary table:
- ✅ `/materias`, `/dashboard`, the previously visited course, `/sysacad` (read-only data) load from cache.
- ✅ A previously opened file (with the toggle on) opens via "Guardar como…" from the IndexedDB copy.
- ✅ The green "Modo Offline" chip is visible in the header.
- ❌ Attempting to inscribirse/desinscribirse in `/sysacad/inscripcion`, changing password, posting in `/foro`, or sending a chat message all show the "Necesitás conexión a internet" modal instead of failing silently.
- ❌ Login/logout still requires the network (unchanged, `/api/auth` never cached).

- [ ] **Step 3: Regression check on guest mode**

Log in as guest (existing guest-mode entry point) and confirm `triggerGuestBlock()` still fires correctly on the same call sites touched in Task 3 (both checks — guest and offline — coexist; guest check still runs first since it was left in place, offline check is additive).

- [ ] **Step 4: No commit for this task** — it's a verification pass only. If any check fails, fix the offending task's code and amend that task's commit history with a new fix commit (do not silently edit prior commits).
