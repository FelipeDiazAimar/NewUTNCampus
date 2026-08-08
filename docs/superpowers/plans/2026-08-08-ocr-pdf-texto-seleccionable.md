# Texto seleccionable en PDFs (nativo + OCR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make text in `CampusPDFViewer` selectable/copiable — using the PDF's real embedded text where it exists, and falling back to client-side OCR (Tesseract.js) for scanned pages that have none — without reintroducing the crash that made `react-pdf`'s built-in text layer get disabled.

**Architecture:** A new `PageTextOverlay` component mounts on top of each already-rendered page `<canvas>` in `CampusPDFViewer`. It never uses `react-pdf`'s `TextLayer` (the crashing component) — instead it calls `pdfjs-dist`'s `page.getTextContent()` directly for native text, and falls back to a Tesseract.js OCR pass on the rendered canvas when a page has no native text. OCR results are cached per-page in IndexedDB so repeat views of the same scanned PDF are instant. Every step is wrapped so a failure just skips the overlay for that page — the visible canvas rendering (today's working behavior) is never affected.

**Tech Stack:** Next.js App Router, React 19, `react-pdf` 10.x / `pdfjs-dist` (already a transitive dep of `react-pdf`), `tesseract.js` (new dependency), browser IndexedDB (native, no wrapper library).

No test suite is configured in this project (see `CLAUDE.md`). Every task ends with a manual verification step (dev server + browser) instead of an automated test run.

## Global Constraints

- Never let a `PageTextOverlay` failure crash or blank the PDF viewer — this is the exact bug (`Cannot read properties of null (reading 'childNodes')`) this feature must not reintroduce. Every async step must be try/caught and fail silently (no overlay for that page) on error.
- Do not use `react-pdf`'s `renderTextLayer`/`renderAnnotationLayer` props or its `TextLayer` component — use `pdfjs-dist` APIs directly (`page.getTextContent()`).
- OCR language: `spa+eng` (Tesseract.js language packs), loaded lazily — never in the initial bundle, never before a page is confirmed to have no native text.
- OCR runs 100% client-side (browser), no new API route.
- OCR results cache key: `` `${cacheKeyPrefix}:${pageNumber}` ``, where `cacheKeyPrefix` is a hash of the viewer's existing `fileKey` string (see `components/CampusPDFViewer.tsx:130`).
- Overlay spans are visually invisible (`color: transparent`) and must not alter the page's visible appearance — only add selectable text behind/over the canvas.

---

## File Structure

- Create: `lib/ocrCache.ts` — `OcrWord` type, `hashString()`, `getCachedPage()`, `setCachedPage()` (IndexedDB wrapper).
- Create: `lib/ocrWorker.ts` — lazy singleton Tesseract.js worker, `recognizePage(canvas): Promise<OcrWord[]>`.
- Create: `components/PageTextOverlay.tsx` — resolves native text or OCR text for one page and renders selectable spans.
- Modify: `components/CampusPDFViewer.tsx` — wrap each page in a positioned container, compute `cacheKeyPrefix`, mount `PageTextOverlay` after render.
- Modify: `package.json` — add `tesseract.js` dependency.

---

### Task 1: Add the Tesseract.js dependency

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `tesseract.js` package available for import in later tasks (`import { createWorker } from "tesseract.js"`).

- [ ] **Step 1: Install the package**

Run: `npm install tesseract.js`

- [ ] **Step 2: Verify it installed correctly**

Run: `npm ls tesseract.js`
Expected: prints the installed version (e.g. `tesseract.js@6.x.x`) with no `UNMET DEPENDENCY` error.

- [ ] **Step 3: Verify the project still builds**

Run: `npm run build`
Expected: build completes successfully (new dependency alone shouldn't break anything since nothing imports it yet).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add tesseract.js dependency for OCR fallback"
```

---

### Task 2: OCR cache (IndexedDB wrapper + hash helper)

**Files:**
- Create: `lib/ocrCache.ts`

**Interfaces:**
- Produces:
  - `interface OcrWord { text: string; x: number; y: number; width: number; height: number }` — coordinates and size as fractions (0-1) of page width/height, so they're scale-independent.
  - `function hashString(input: string): string` — small non-cryptographic hash (fnv1a), returns a hex string.
  - `async function getCachedPage(key: string): Promise<OcrWord[] | null>`
  - `async function setCachedPage(key: string, words: OcrWord[]): Promise<void>`
- Consumes: nothing (leaf module).

- [ ] **Step 1: Write `lib/ocrCache.ts`**

```ts
export interface OcrWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const DB_NAME = "campus-ocr-cache";
const STORE_NAME = "ocr_pages";
const DB_VERSION = 1;

export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedPage(key: string): Promise<OcrWord[] | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as OcrWord[] | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function setCachedPage(key: string, words: OcrWord[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(words, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Cache write failures are non-fatal — the page just re-runs OCR next time.
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/ocrCache.ts`.

- [ ] **Step 3: Manual verification in the browser console**

Run `npm run dev`, open any page of the app in the browser, open devtools console, and paste:

```js
const { getCachedPage, setCachedPage, hashString } = await import("/lib/ocrCache.ts");
console.log(hashString("hello")); // deterministic hex string, same value every call
await setCachedPage("test:1", [{ text: "hola", x: 0.1, y: 0.1, width: 0.2, height: 0.05 }]);
console.log(await getCachedPage("test:1")); // logs the array back
console.log(await getCachedPage("missing:1")); // logs null
```

Expected: `hashString` is deterministic, `setCachedPage`/`getCachedPage` round-trip the array, and a missing key returns `null`. (Note: Next.js dev server serves TS via its own module graph, not raw `/lib/...ts` — if the dynamic import above doesn't resolve, instead temporarily call these functions from a `useEffect` in any client page, log the results, and remove the temporary code after confirming.)

- [ ] **Step 4: Commit**

```bash
git add lib/ocrCache.ts
git commit -m "feat: add IndexedDB-backed OCR result cache"
```

---

### Task 3: Tesseract.js worker wrapper

**Files:**
- Create: `lib/ocrWorker.ts`

**Interfaces:**
- Consumes: `OcrWord` from `lib/ocrCache.ts`.
- Produces: `async function recognizePage(canvas: HTMLCanvasElement): Promise<OcrWord[]>`.

- [ ] **Step 1: Write `lib/ocrWorker.ts`**

```ts
import { createWorker, type Worker } from "tesseract.js";
import type { OcrWord } from "./ocrCache";

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("spa+eng").catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export async function recognizePage(canvas: HTMLCanvasElement): Promise<OcrWord[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  const pageWidth = canvas.width;
  const pageHeight = canvas.height;
  const words = (data.words ?? []) as Array<{
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
  return words
    .filter((w) => w.text.trim().length > 0)
    .map((w) => ({
      text: w.text,
      x: w.bbox.x0 / pageWidth,
      y: w.bbox.y0 / pageHeight,
      width: (w.bbox.x1 - w.bbox.x0) / pageWidth,
      height: (w.bbox.y1 - w.bbox.y0) / pageHeight,
    }));
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/ocrWorker.ts`. If `tesseract.js`'s types don't export `Worker` the way expected, check the installed version's `.d.ts` (`node_modules/tesseract.js/dist/types`) and adjust the import to match (e.g. `import type { Worker } from "tesseract.js/dist/types"` if needed) — do not use `any`.

- [ ] **Step 3: Manual verification**

Create a temporary test page or add a temporary button anywhere client-side that:
1. Draws some text onto an offscreen `<canvas>` (e.g. `ctx.font = "30px sans-serif"; ctx.fillText("Hola Mundo 123", 10, 40);` on a 300x60 canvas).
2. Calls `await recognizePage(canvas)` and `console.log`s the result.

Run `npm run dev`, trigger the button, and confirm the console logs an array of `OcrWord` objects whose `text` values roughly reconstruct "Hola Mundo 123" (OCR won't be pixel-perfect, but should recognize most words). Remove the temporary test code after confirming.

- [ ] **Step 4: Commit**

```bash
git add lib/ocrWorker.ts
git commit -m "feat: add lazy Tesseract.js worker wrapper for page OCR"
```

---

### Task 4: `PageTextOverlay` — native text path only

**Files:**
- Create: `components/PageTextOverlay.tsx`

**Interfaces:**
- Consumes: nothing from `lib/ocrCache.ts` or `lib/ocrWorker.ts` yet (added in Task 6). Uses `PDFPageProxy` type from `pdfjs-dist`.
- Produces: `export default function PageTextOverlay(props: { page: PDFPageProxy | null; scale: number }): JSX.Element | null` — a component later tasks will pass more props to (extended, not renamed, in Task 6).

This task covers the majority case (PDFs with real embedded text) end-to-end, independent of OCR, so it's independently useful and testable before OCR is wired in.

- [ ] **Step 1: Write `components/PageTextOverlay.tsx`**

`fontSize` is computed as a fraction of page height, then converted to pixels using `pageHeightPx` (the container's actual rendered height, passed in by the caller from the canvas element) — CSS `font-size: %` can't be used directly here since percent font-size resolves against the parent's font-size, not the parent's height. `left`/`top` stay as `%`, which works because the overlay container is `position: absolute; inset: 0`, exactly matching the canvas.

```tsx
"use client";

import { useEffect, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";

interface Span {
  text: string;
  left: number;     // percent of page width
  top: number;      // percent of page height
  fontSize: number;  // fraction (0-1) of page height
}

interface Props {
  page: PDFPageProxy | null;
  scale: number;
  pageHeightPx: number;
}

export default function PageTextOverlay({ page, scale, pageHeightPx }: Props) {
  const [spans, setSpans] = useState<Span[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSpans(null);
    if (!page) return;

    (async () => {
      try {
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
        const totalChars = textContent.items.reduce(
          (n, item) => n + ("str" in item ? item.str.length : 0),
          0,
        );
        if (totalChars < 3) {
          if (!cancelled) setSpans([]);
          return;
        }
        const built: Span[] = [];
        for (const item of textContent.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const tx = item.transform;
          const fontHeight = Math.hypot(tx[2], tx[3]);
          const x = tx[4];
          const y = tx[5];
          built.push({
            text: item.str,
            left: (x / viewport.width) * 100,
            top: ((viewport.height - y - fontHeight) / viewport.height) * 100,
            fontSize: fontHeight / viewport.height,
          });
        }
        if (!cancelled) setSpans(built);
      } catch {
        if (!cancelled) setSpans([]);
      }
    })();

    return () => { cancelled = true; };
  }, [page, scale]);

  if (!spans || spans.length === 0) return null;

  return (
    <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {spans.map((s, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${s.left}%`,
            top: `${s.top}%`,
            fontSize: `${s.fontSize * pageHeightPx}px`,
            color: "transparent",
            whiteSpace: "pre",
            lineHeight: 1,
            pointerEvents: "auto",
            userSelect: "text",
          }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors referencing `components/PageTextOverlay.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/PageTextOverlay.tsx
git commit -m "feat: add PageTextOverlay rendering native PDF text as selectable spans"
```

---

### Task 5: Wire `PageTextOverlay` into `CampusPDFViewer`

**Files:**
- Modify: `components/CampusPDFViewer.tsx`

**Interfaces:**
- Consumes: `PageTextOverlay` from Task 4 (`{ page, scale, pageHeightPx }` props per the fix noted in Task 4 Step 1).

- [ ] **Step 1: Wrap each page in a positioned container and track its rendered height**

In `components/CampusPDFViewer.tsx`, modify the `PagesList` component (lines 74-93) to wrap each `<Page>` in a relatively-positioned `<div>`, track that page's `PDFPageProxy` (via `pdfDocRef`), and render `PageTextOverlay` inside it:

```tsx
const PagesList = memo(function PagesList({
  numPages, pageWidth, scale, onPageRendered, getPage,
}: {
  numPages: number;
  pageWidth: number | undefined;
  scale: number;
  onPageRendered: () => void;
  getPage: (pageNumber: number) => PDFPageProxy | null;
}) {
  return (
    <div className="flex flex-col gap-4 items-center">
      {Array.from({ length: numPages }, (_, i) => (
        <PageWithOverlay
          key={`page_${i + 1}`}
          pageNumber={i + 1}
          pageWidth={pageWidth}
          scale={scale}
          onPageRendered={onPageRendered}
          getPage={getPage}
        />
      ))}
    </div>
  );
});

function PageWithOverlay({
  pageNumber, pageWidth, scale, onPageRendered, getPage,
}: {
  pageNumber: number;
  pageWidth: number | undefined;
  scale: number;
  onPageRendered: () => void;
  getPage: (pageNumber: number) => PDFPageProxy | null;
}) {
  const [rendered, setRendered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={containerRef} className="relative" style={{ lineHeight: 0 }}>
      <Page pageNumber={pageNumber} width={pageWidth} scale={scale}
        loading={<PageSkeleton />}
        renderTextLayer={false} renderAnnotationLayer={false}
        onRenderSuccess={() => { setRendered(true); onPageRendered(); }}
        className="shadow-2xl" />
      {rendered && (
        <PageTextOverlay
          page={getPage(pageNumber)}
          scale={scale}
          pageHeightPx={containerRef.current?.clientHeight ?? 0}
        />
      )}
    </div>
  );
}
```

Add the needed imports at the top of the file: `import { useState as useStateAlias } from "react";` — actually `useState`/`useRef` are already imported at line 3 (`useState, useEffect, useRef, useCallback, memo`), so no new import is needed for those. Add:
```tsx
import PageTextOverlay from "./PageTextOverlay";
```

- [ ] **Step 2: Provide `getPage` from the parent `CampusPDFViewer`**

In the main `CampusPDFViewer` function, add a `getPage` callback backed by a small in-memory map populated as pages resolve, since `pdfDocRef.current.getPage(n)` is async but `PageTextOverlay` needs a synchronous prop. Add after `pdfDocRef`:

```tsx
const [resolvedPages, setResolvedPages] = useState<Map<number, PDFPageProxy>>(new Map());

const getPage = useCallback((pageNumber: number) => resolvedPages.get(pageNumber) ?? null, [resolvedPages]);
```

In `handleDocLoad` (or right after `setNumPages(pdf.numPages)`), kick off resolving all pages in the background:

```tsx
async function handleDocLoad(pdf: PDFDocumentProxy) {
  pdfDocRef.current = pdf;
  setRenderedPages(0);
  setNumPages(pdf.numPages);
  setResolvedPages(new Map());
  for (let n = 1; n <= pdf.numPages; n++) {
    pdf.getPage(n).then((page) => {
      setResolvedPages((prev) => {
        const next = new Map(prev);
        next.set(n, page);
        return next;
      });
    }).catch(() => { /* page fetch failed — overlay just won't render for it */ });
  }
  if (onAspectRatio && !aspectReportedRef.current) {
    try {
      const pg = await pdf.getPage(1);
      const vp = pg.getViewport({ scale: 1 });
      onAspectRatio(vp.width / vp.height);
      aspectReportedRef.current = true;
    } catch { /* ignore */ }
  }
}
```

Pass `getPage` down: `<PagesList numPages={numPages} pageWidth={pageWidth} scale={scale} onPageRendered={handlePageRendered} getPage={getPage} />`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors in `components/CampusPDFViewer.tsx`.

- [ ] **Step 4: Manual verification — normal text PDF**

Run `npm run dev`, log into the app, open a course file that's a PDF with real embedded text (any lecture slide/notes export). Confirm:
- The PDF renders exactly as before (canvas image, same layout).
- Click-and-drag selects text, and the selected text visually roughly follows the words underneath (won't be pixel-perfect at all zoom levels, but readable text should be selectable and copy-pasteable via Ctrl+C into a text editor, matching the visible words).

- [ ] **Step 5: Manual verification — no regression on zoom/scroll**

In the same PDF, zoom in/out with the toolbar buttons and scroll through multiple pages. Confirm no crash, no console errors, and the viewer remains responsive (this exercises the exact remount path that used to crash with `react-pdf`'s own text layer).

- [ ] **Step 6: Commit**

```bash
git add components/CampusPDFViewer.tsx
git commit -m "feat: mount PageTextOverlay over rendered PDF pages for native text selection"
```

---

### Task 6: OCR fallback in `PageTextOverlay`

**Files:**
- Modify: `components/PageTextOverlay.tsx`
- Modify: `components/CampusPDFViewer.tsx` (pass the rendered canvas element down)

**Interfaces:**
- Consumes: `recognizePage` from `lib/ocrWorker.ts` (Task 3), `getCachedPage`/`setCachedPage`/`hashString` from `lib/ocrCache.ts` (Task 2).
- Produces: `PageTextOverlay` now accepts an additional `cacheKey: string` prop (e.g. `` `${cacheKeyPrefix}:${pageNumber}` ``) and an additional `canvasEl: HTMLCanvasElement | null` prop (the page's rendered canvas, for the OCR image source).

- [ ] **Step 1: Extend `Props` and the native-text effect in `PageTextOverlay.tsx`**

Add to `Props`: `cacheKey: string; canvasEl: HTMLCanvasElement | null;`. In the `useEffect`, after computing `totalChars < 3` (no native text found), instead of `setSpans([])`, add the OCR fallback:

```tsx
if (totalChars < 3) {
  if (!canvasEl) { if (!cancelled) setSpans([]); return; }
  try {
    const cached = await getCachedPage(cacheKey);
    const words = cached ?? await recognizePage(canvasEl);
    if (!cached) await setCachedPage(cacheKey, words);
    const built: Span[] = words
      .filter((w) => w.text.trim())
      .map((w) => ({
        text: w.text,
        left: w.x * 100,
        top: w.y * 100,
        fontSize: w.height * 100,
      }));
    if (!cancelled) setSpans(built);
  } catch {
    if (!cancelled) setSpans([]);
  }
  return;
}
```

Add the imports: `import { recognizePage } from "@/lib/ocrWorker"; import { getCachedPage, setCachedPage } from "@/lib/ocrCache";`.

- [ ] **Step 2: Add an OCR-in-progress indicator**

Add an `ocrPending` state, set to `true` right before calling `recognizePage` (only on cache miss) and `false` in a `finally`. Render a small spinner when `ocrPending` is true:

```tsx
const [ocrPending, setOcrPending] = useState(false);
```
Wrap the `recognizePage` call: `setOcrPending(true); try { words = await recognizePage(canvasEl); } finally { setOcrPending(false); }`.

At the end of the component, before the main `return`, add:
```tsx
if (ocrPending) {
  return (
    <div className="absolute top-2 right-2 pointer-events-none" title="Reconociendo texto…">
      <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
    </div>
  );
}
```
(placed so it renders even while `spans` is still `null`/empty during OCR).

- [ ] **Step 3: Pass `cacheKey` and `canvasEl` from `CampusPDFViewer.tsx`**

In `PageWithOverlay` (Task 5), find the canvas element rendered by `<Page>` via the container ref (react-pdf renders a `<canvas>` inside the `<Page>`'s wrapper). After `rendered` becomes `true`, read it:

```tsx
const canvasEl = containerRef.current?.querySelector("canvas") ?? null;
```

Compute this inside the render (it's fine — `containerRef.current` is stable once mounted, and this only matters once `rendered` is `true`). Pass `cacheKey={`${cacheKeyPrefix}:${pageNumber}`}` and `canvasEl={canvasEl}` to `<PageTextOverlay>`. Thread `cacheKeyPrefix` as a new prop from `PagesList` down from the top-level `CampusPDFViewer`, computed once per document:

```tsx
const cacheKeyPrefix = useMemo(() => hashString(fileKey), [fileKey]);
```
(import `hashString` from `@/lib/ocrCache` and `useMemo` from `react` in `CampusPDFViewer.tsx`). Pass `cacheKeyPrefix` through `PagesList` → `PageWithOverlay` → `PageTextOverlay`.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification — scanned PDF**

Find or create a scanned-style PDF (a PDF made from a photo/screenshot of text, with no embedded text layer — e.g. print a text document "as image" or scan a page). Open it in the viewer and confirm:
- The page renders normally (image) immediately.
- A small spinner appears briefly in the corner of that page.
- After a few seconds, the spinner disappears and the recognized text becomes selectable — select a sentence and confirm the copied text roughly matches what's printed on the page.

- [ ] **Step 6: Manual verification — cache hit**

Close and reopen the same scanned PDF (or navigate away and back). Confirm the spinner does not reappear (or appears much more briefly) and text is selectable almost immediately — check via `console.log` temporarily in `getCachedPage`/`setCachedPage` calls, or just observe the absence of the multi-second delay.

- [ ] **Step 7: Commit**

```bash
git add components/PageTextOverlay.tsx components/CampusPDFViewer.tsx
git commit -m "feat: fall back to cached client-side OCR when a PDF page has no native text"
```

---

### Task 7: Full regression pass and cleanup

**Files:**
- None expected to change, unless verification surfaces a bug — fix in the relevant file from Tasks 1-6.

- [ ] **Step 1: Run the linter**

Run: `npm run lint`
Expected: no new errors/warnings introduced by the new files or edits.

- [ ] **Step 2: Run a full production build**

Run: `npm run build`
Expected: builds successfully (this also validates all TypeScript across the app, not just the files touched).

- [ ] **Step 3: Full manual pass through the spec's testing checklist**

With `npm run dev` running, walk through all six scenarios from the design spec (`docs/superpowers/specs/2026-08-08-ocr-pdf-texto-seleccionable-design.md`, Testing section):
1. Text-real PDF → selects/copies correctly, no OCR spinner.
2. A previously-crashing PDF (if one is available/reproducible) → no crash, text selectable if it has native text.
3. Scanned PDF → OCR spinner then selectable text, reasonable accuracy.
4. Reopen the same scanned PDF → cache hit, near-instant.
5. Zoom in/out on a document with an active overlay → spans stay visually aligned with the canvas text.
6. A multi-page scanned document → UI stays responsive while multiple pages OCR in the background (open devtools Performance tab or just observe scrolling/interaction isn't blocked).

- [ ] **Step 4: Commit any fixes found during verification**

If Step 3 surfaces issues, fix them in the appropriate file and commit:
```bash
git add -A
git commit -m "fix: address issues found in OCR text-overlay regression pass"
```
If no issues were found, skip this step (nothing to commit).

---

## Self-Review Notes

- **Spec coverage:** Native text path (Task 4-5), OCR fallback (Task 6), IndexedDB cache (Task 2, wired in Task 6), progress indicator (Task 6 Step 2), error containment so the viewer never crashes (built into every `try/catch` across Tasks 4 and 6), `spa+eng` language (Task 3), scale/zoom re-alignment (verified Task 5 Step 5 and Task 7 Step 3.5) — all covered.
- **Out of scope items from the spec** (OCR of non-PDF images, server-side OCR, manual text correction, exporting an OCR'd PDF) are correctly not present in any task.
- **Type consistency:** `OcrWord` (Task 2) is consumed identically in `lib/ocrWorker.ts` (Task 3) and `components/PageTextOverlay.tsx` (Task 6) — same field names (`text`, `x`, `y`, `width`, `height`) throughout. `PageTextOverlay`'s prop set grows across Tasks 4 → 6 (`page`, `scale`, `pageHeightPx` → `+ cacheKey`, `+ canvasEl`); each task that adds props also updates every call site in the same task, so no task leaves a mismatched signature.
