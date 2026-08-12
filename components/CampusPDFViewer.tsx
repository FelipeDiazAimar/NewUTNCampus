"use client";

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import PageTextOverlay from "./PageTextOverlay";
import { hashString } from "@/lib/ocrCache";
import { getCachedPdfBytes, fetchPdfBytes } from "@/lib/pdfByteCache";
import { reportClientError } from "@/lib/clientErrorReporter";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type PDFSource = string | Blob | ArrayBuffer;

interface Props {
  src: PDFSource;
  /** "75vh" (default standalone) or "100%" (workspace fill-parent mode) */
  maxHeight?: string;
  /** Called once after page 1 loads with width/height ratio of the PDF */
  onAspectRatio?: (ratio: number) => void;
  /** Initial zoom level — defaults to 1.0 (100%) */
  initialScale?: number;
  /** Use light (white) background instead of dark gray */
  lightPanel?: boolean;
}

// ─── Page skeleton ────────────────────────────────────────────────────────────

function PageSkeleton() {
  const lines = [60, 100, 85, 100, 100, 40, 100, 90, 100, 100, 70, 100, 95, 55];
  return (
    <div className="bg-white rounded-sm shadow-lg" style={{ width: "100%", maxWidth: 640, padding: "48px 56px" }}>
      <div className="h-6 w-2/5 bg-[#e5e5ea] rounded animate-pulse mb-8" />
      <div className="space-y-3">
        {lines.map((w, i) => (
          <div key={i} className="bg-[#e5e5ea] rounded animate-pulse"
            style={{ height: 10, width: `${w}%`, animationDelay: `${(i * 0.07).toFixed(2)}s` }} />
        ))}
      </div>
      <div className="mt-8 space-y-3">
        {[100, 80, 100, 65, 100].map((w, i) => (
          <div key={i} className="bg-[#e5e5ea] rounded animate-pulse"
            style={{ height: 10, width: `${w}%`, animationDelay: `${(i * 0.07 + 1).toFixed(2)}s` }} />
        ))}
      </div>
    </div>
  );
}

// ─── Toolbar button ───────────────────────────────────────────────────────────

function TBtn({ onClick, disabled, title, children, minW, light }: {
  onClick: () => void; disabled?: boolean; title?: string;
  children: React.ReactNode; minW?: number; light?: boolean;
}) {
  const base = light
    ? disabled ? "text-[#1c1c1e]/25 cursor-default" : "text-[#1c1c1e]/70 hover:bg-black/10 cursor-pointer"
    : disabled ? "text-white/25 cursor-default" : "text-white/90 hover:bg-white/[0.12] cursor-pointer";
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`flex items-center justify-center h-8 rounded text-[13px] font-medium transition-colors select-none ${base}`}
      style={{ minWidth: minW ?? 32, padding: "0 6px" }}>
      {children}
    </button>
  );
}

// ─── PageWithOverlay ──────────────────────────────────────────────────────────
// Canvas-only render for the <Page> itself. The text/struct-tree layer built
// into react-pdf throws a synchronous "Cannot read properties of null (reading
// 'childNodes')" on some PDFs, which crashes the whole viewer (blank panel).
// Rendering canvas only is the one path that never throws, so the PDF is always
// visible. Text selection instead comes from PageTextOverlay, which reads
// pdfjs-dist directly (bypassing react-pdf's crashing TextLayer) and never lets
// a failure affect the canvas rendering above.
function PageWithOverlay({
  pageNumber, pageWidth, scale, onPageRendered, getPage, cacheKeyPrefix,
}: {
  pageNumber: number;
  pageWidth: number | undefined;
  scale: number;
  onPageRendered: () => void;
  getPage: (pageNumber: number) => PDFPageProxy | null;
  cacheKeyPrefix: string;
}) {
  const [rendered, setRendered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasEl = rendered ? (containerRef.current?.querySelector("canvas") ?? null) : null;
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
          cacheKey={`${cacheKeyPrefix}:${pageNumber}`}
          canvasEl={canvasEl}
        />
      )}
    </div>
  );
}

// ─── PagesList (memoized) ─────────────────────────────────────────────────────
// Memoizing keeps the page canvases stable while the parent's page counter updates.
const PagesList = memo(function PagesList({
  numPages, pageWidth, scale, onPageRendered, getPage, cacheKeyPrefix,
}: {
  numPages: number;
  pageWidth: number | undefined;
  scale: number;
  onPageRendered: () => void;
  getPage: (pageNumber: number) => PDFPageProxy | null;
  cacheKeyPrefix: string;
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
          cacheKeyPrefix={cacheKeyPrefix}
        />
      ))}
    </div>
  );
});

// ─── Loading overlay (mirrors the progress-bar style used for docx/xlsx) ──────
// Sits over the document area while pages are still rendering, so there's
// always a visible loader instead of blank white space peeking through the
// per-page skeletons.
// Byte download (pdf.js range/streaming progress) accounts for most of the
// wait, so it gets the bulk of the bar; per-page canvas rendering is fast
// once bytes are local and just tops off the remaining sliver. Weighting it
// this way keeps the bar moving continuously instead of sitting at 0% during
// the download and then jumping straight to 100% once rendering starts.
const FETCH_WEIGHT = 85;
const RENDER_WEIGHT = 100 - FETCH_WEIGHT;

function LoadingOverlay({ numPages, renderedPages, docLoaded, docTotal, lightPanel }: {
  numPages: number; renderedPages: number; docLoaded: number; docTotal: number; lightPanel: boolean;
}) {
  const bg       = lightPanel ? "rgba(224,224,229,0.92)" : "rgba(82,86,89,0.92)";
  const trackBg  = lightPanel ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.15)";
  const labelClr = lightPanel ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.55)";
  const pctClr   = lightPanel ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.70)";

  const knownTotal = docTotal > 0;
  const fetchPct = knownTotal ? Math.min(FETCH_WEIGHT, Math.round((docLoaded / docTotal) * FETCH_WEIGHT)) : 0;
  const label = numPages > 0 ? "Renderizando páginas…" : "Cargando documento…";

  // Total byte size unknown (server didn't send content-length) and the
  // document hasn't parsed yet — nothing measurable to show a bar for, so
  // fall back to an indeterminate spinner rather than a bar frozen at 0%.
  if (!knownTotal && numPages === 0) {
    const spinClr = lightPanel ? "border-[#1c1c1e]/30" : "border-white/40";
    const spinTxt = lightPanel ? "text-[#1c1c1e]/50" : "text-white/60";
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: bg }}>
        <div className="flex items-center gap-2.5">
          <div className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${spinClr}`} />
          <span className={`text-[13px] ${spinTxt}`}>{label}</span>
        </div>
      </div>
    );
  }

  const pct = numPages > 0
    ? FETCH_WEIGHT + Math.round((renderedPages / numPages) * RENDER_WEIGHT)
    : fetchPct;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: bg }}>
      <div className="w-56 flex flex-col gap-2">
        <span className="text-[12px] truncate" style={{ color: labelClr }}>{label}</span>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: trackBg }}>
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: "#007aff" }} />
          </div>
          <span className="text-[12px] tabular-nums font-medium shrink-0" style={{ color: pctClr }}>{pct}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── CampusPDFViewer ──────────────────────────────────────────────────────────

export default function CampusPDFViewer({ src, maxHeight = "75vh", onAspectRatio, initialScale = 1.0, lightPanel = false }: Props) {
  const [numPages, setNumPages]         = useState(0);
  const [renderedPages, setRenderedPages] = useState(0);
  const [scale, setScale]               = useState(initialScale);
  const [docError, setDocError]         = useState<string | null>(null);
  const [docProgress, setDocProgress]   = useState({ loaded: 0, total: 0 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const aspectReportedRef = useRef(false);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);

  // PDFPageProxy per page number, resolved asynchronously as the document loads.
  // PageTextOverlay needs a synchronous page prop, so pages are pre-resolved here
  // rather than fetched on demand inside the overlay.
  const [resolvedPages, setResolvedPages] = useState<Map<number, PDFPageProxy>>(new Map());
  const getPage = useCallback(
    (pageNumber: number) => resolvedPages.get(pageNumber) ?? null,
    [resolvedPages],
  );

  // TEMP PERF LOGGING — remove once the slow-wifi bottleneck is found.
  const perfT0Ref = useRef(0);
  const perfLastPctRef = useRef(-1);

  // Resolve src → react-pdf file prop, clean up objectURLs.
  // Plain http(s)/relative URLs (our /api/files proxy) are routed through a
  // session-scoped byte cache (lib/pdfByteCache.ts) so a file the user already
  // opened this session — even after closing the preview and coming back —
  // loads instantly from memory instead of re-downloading it.
  const [file, setFile] = useState<string | { data: ArrayBuffer } | null>(null);
  useEffect(() => {
    aspectReportedRef.current = false;
    // Reset render state so stale async page renders from the previous document
    // never paint into DOM nodes that have already been unmounted.
    setNumPages(0);
    setRenderedPages(0);
    setDocError(null);
    setDocProgress({ loaded: 0, total: 0 });
    perfT0Ref.current = performance.now();
    perfLastPctRef.current = -1;

    if (src instanceof Blob) {
      console.log(`[pdf-perf] t=0ms src set (blob)`);
      const url = URL.createObjectURL(src);
      setFile(url);
      return () => URL.revokeObjectURL(url);
    }
    if (src instanceof ArrayBuffer) {
      console.log(`[pdf-perf] t=0ms src set (buffer)`);
      setFile({ data: src });
      return undefined;
    }

    // blob:/data: URLs are already local (e.g. a Drive-converted PDF) — no
    // network fetch involved, so there's nothing to cache.
    if (src.startsWith("blob:") || src.startsWith("data:")) {
      console.log(`[pdf-perf] t=0ms src set (local url)`);
      setFile(src);
      return undefined;
    }

    const cached = getCachedPdfBytes(src);
    if (cached) {
      console.log(`[pdf-perf] t=0ms served from cache (${cached.byteLength} bytes)`, src);
      // pdf.js transfers this buffer to its worker, which detaches (empties) it —
      // hand it a copy so the cached original stays intact for the next open.
      setFile({ data: cached.slice(0) });
      return undefined;
    }

    console.log(`[pdf-perf] t=0ms src set (fetching)`, src);
    let cancelled = false;
    fetchPdfBytes(src, (loaded, total) => {
      if (cancelled) return;
      setDocProgress({ loaded, total });
      const pct = total > 0 ? Math.round((loaded / total) * 100) : -1;
      // Only log every ~10% so bad-wifi runs (hundreds of progress events) don't flood the console.
      if (pct !== perfLastPctRef.current && (pct === -1 || pct % 10 === 0 || pct === 100)) {
        perfLastPctRef.current = pct;
        console.log(`[pdf-perf] t=${Math.round(performance.now() - perfT0Ref.current)}ms download ${loaded}/${total} bytes (${pct}%)`);
      }
    })
      // Same reasoning: fetchPdfBytes also stashes this exact buffer in the
      // cache, so pass pdf.js a copy rather than the cached original.
      .then((buf) => { if (!cancelled) setFile({ data: buf.slice(0) }); })
      .catch((e) => {
        if (!cancelled) setDocError((e as Error).message);
        reportClientError("warning", `Carga de PDF: ${(e as Error).message}`, {
          stack: e instanceof Error ? (e.stack ?? null) : null,
        });
      });
    return () => { cancelled = true; };
  }, [src]);

  // Stable identity for the current document — derived from `src` (not the
  // resolved `file`, which collapses to a generic buffer object for every
  // cached/fetched URL) so <Document> and the OCR cache key remount/change
  // per-file instead of colliding once caching is in play.
  const fileKey = typeof src === "string" ? src : src instanceof Blob || src instanceof ArrayBuffer ? "buffer" : "none";

  // Stable per-document prefix for OCR cache keys — combined with the page
  // number in PageWithOverlay so each page's cached OCR result is looked up
  // independently.
  const cacheKeyPrefix = useMemo(() => hashString(fileKey), [fileKey]);

  // Responsive page width.
  // The ResizeObserver fires repeatedly while the workspace panel animates open,
  // and the very first measurement jumps from 0 → real width. Each change re-renders
  // every <Page>, and if a page's canvas/text layer is mid-render when it unmounts,
  // PDF.js throws "Cannot read properties of null (reading 'childNodes')".
  // To prevent that we (1) ignore sub-pixel jitter and (2) debounce the final value.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      clearTimeout(t);
      t = setTimeout(() => {
        setContainerWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
      }, 120);
    });
    ro.observe(el);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, []);

  const pageWidth = containerWidth > 0 ? Math.floor(containerWidth - 32) : undefined;

  // Stable so PagesList stays memoized across the parent's counter re-renders.
  const handlePageRendered = useCallback(() => {
    setRenderedPages((n) => {
      const next = n + 1;
      console.log(`[pdf-perf] t=${Math.round(performance.now() - perfT0Ref.current)}ms page ${next} rendered`);
      return next;
    });
  }, []);

  // Destroy previous document when src changes or component unmounts
  useEffect(() => {
    return () => { pdfDocRef.current?.destroy(); pdfDocRef.current = null; };
  }, [src]);

  async function handleDocLoad(pdf: PDFDocumentProxy) {
    console.log(`[pdf-perf] t=${Math.round(performance.now() - perfT0Ref.current)}ms document parsed, ${pdf.numPages} pages`);
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

  function zoom(delta: number) {
    setScale((s) => parseFloat(Math.max(0.25, Math.min(4, s + delta)).toFixed(2)));
  }

  // Fill parent (workspace mode) vs self-contained (standalone mode)
  const containerStyle: React.CSSProperties = {
    height: maxHeight,
    maxHeight,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  };

  return (
    <div style={containerStyle}>
      {/* ── Toolbar ────────────────────────────────────── */}
      <div className="flex items-center justify-between px-2 shrink-0 border-b"
        style={{ background: lightPanel ? "#e8e8ed" : "#38383d", height: 40, borderColor: lightPanel ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.3)" }}>
        <div className="flex items-center gap-2">
          <span className="text-[13px] tabular-nums select-none" style={{ color: lightPanel ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.9)" }}>
            {numPages > 0
              ? renderedPages < numPages
                ? `${renderedPages} / ${numPages} páginas`
                : `${numPages} página${numPages === 1 ? "" : "s"}`
              : "—"}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <TBtn onClick={() => zoom(-0.25)} disabled={scale <= 0.25} title="Alejar" light={lightPanel}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </TBtn>
          <TBtn onClick={() => setScale(1)} title="Restablecer zoom (100%)" minW={52} light={lightPanel}>
            {Math.round(scale * 100)}%
          </TBtn>
          <TBtn onClick={() => zoom(0.25)} disabled={scale >= 4} title="Acercar" light={lightPanel}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </TBtn>
        </div>
      </div>

      {/* ── Document area ──────────────────────────────── */}
      <div ref={scrollRef} className="relative overflow-y-auto flex-1 min-h-0 p-4" style={{ background: lightPanel ? "#e0e0e5" : "#525659" }}>
        {docError ? (
          <div className="text-center py-16 px-6">
            <p className="text-[#ff6b6b] text-[14px] mb-2">No se pudo cargar el documento</p>
            <p className="text-[rgba(255,107,107,0.6)] text-[12px]">{docError}</p>
          </div>
        ) : !file ? (
          // Still fetching bytes (see the src-resolution effect above) — nothing
          // for <Document> to mount yet, but the overlay must still show so the
          // download isn't silently blank the whole time.
          <LoadingOverlay numPages={0} renderedPages={0}
            docLoaded={docProgress.loaded} docTotal={docProgress.total} lightPanel={lightPanel} />
        ) : (
          <>
            {renderedPages < numPages || numPages === 0 ? (
              <LoadingOverlay numPages={numPages} renderedPages={renderedPages}
                docLoaded={docProgress.loaded} docTotal={docProgress.total} lightPanel={lightPanel} />
            ) : null}
            <Document key={fileKey} file={file} onLoadSuccess={handleDocLoad}
              onLoadError={(e) => setDocError(e.message)}
              loading={<PageSkeleton />} error={<span />}>
              <PagesList numPages={numPages} pageWidth={pageWidth} scale={scale}
                onPageRendered={handlePageRendered} getPage={getPage} cacheKeyPrefix={cacheKeyPrefix} />
            </Document>
          </>
        )}
      </div>
    </div>
  );
}
