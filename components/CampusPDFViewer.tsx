"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

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

// ─── PagesList (memoized) ─────────────────────────────────────────────────────
// Canvas-only render. The text/struct-tree layer in react-pdf throws a synchronous
// "Cannot read properties of null (reading 'childNodes')" on some PDFs, which crashes
// the whole viewer (blank panel). Rendering canvas only is the one path that never
// throws, so the PDF is always visible. Trade-off: text isn't selectable.
// Memoizing keeps the page canvases stable while the parent's page counter updates.
const PagesList = memo(function PagesList({
  numPages, pageWidth, scale, onPageRendered,
}: {
  numPages: number;
  pageWidth: number | undefined;
  scale: number;
  onPageRendered: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 items-center">
      {Array.from({ length: numPages }, (_, i) => (
        <Page key={`page_${i + 1}`} pageNumber={i + 1} width={pageWidth} scale={scale}
          loading={<PageSkeleton />}
          renderTextLayer={false} renderAnnotationLayer={false}
          onRenderSuccess={onPageRendered}
          className="shadow-2xl" />
      ))}
    </div>
  );
});

// ─── CampusPDFViewer ──────────────────────────────────────────────────────────

export default function CampusPDFViewer({ src, maxHeight = "75vh", onAspectRatio, initialScale = 1.0, lightPanel = false }: Props) {
  const [numPages, setNumPages]         = useState(0);
  const [renderedPages, setRenderedPages] = useState(0);
  const [scale, setScale]               = useState(initialScale);
  const [docError, setDocError]         = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const aspectReportedRef = useRef(false);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);

  // Resolve src → react-pdf file prop, clean up objectURLs
  const [file, setFile] = useState<string | { data: ArrayBuffer } | null>(null);
  useEffect(() => {
    aspectReportedRef.current = false;
    // Reset render state so stale async page renders from the previous document
    // never paint into DOM nodes that have already been unmounted.
    setNumPages(0);
    setRenderedPages(0);
    setDocError(null);
    if (src instanceof Blob) {
      const url = URL.createObjectURL(src);
      setFile(url);
      return () => URL.revokeObjectURL(url);
    }
    if (src instanceof ArrayBuffer) { setFile({ data: src }); return undefined; }
    setFile(src);
    return undefined;
  }, [src]);

  // Stable identity for the current file — used to force a full remount of
  // <Document> when the source changes, preventing PDF.js from rendering into
  // stale/removed canvases (the "Cannot read properties of null (childNodes)" error).
  const fileKey = typeof file === "string" ? file : file ? "buffer" : "none";

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
  const handlePageRendered = useCallback(() => setRenderedPages((n) => n + 1), []);

  // Destroy previous document when src changes or component unmounts
  useEffect(() => {
    return () => { pdfDocRef.current?.destroy(); pdfDocRef.current = null; };
  }, [src]);

  async function handleDocLoad(pdf: PDFDocumentProxy) {
    pdfDocRef.current = pdf;
    setRenderedPages(0);
    setNumPages(pdf.numPages);
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

  if (!file) return null;

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
      <div ref={scrollRef} className="overflow-y-auto flex-1 min-h-0 p-4" style={{ background: lightPanel ? "#e0e0e5" : "#525659" }}>
        {docError ? (
          <div className="text-center py-16 px-6">
            <p className="text-[#ff6b6b] text-[14px] mb-2">No se pudo cargar el documento</p>
            <p className="text-[rgba(255,107,107,0.6)] text-[12px]">{docError}</p>
          </div>
        ) : (
          <Document key={fileKey} file={file} onLoadSuccess={handleDocLoad}
            onLoadError={(e) => setDocError(e.message)}
            loading={<PageSkeleton />} error={<span />}>
            <PagesList numPages={numPages} pageWidth={pageWidth} scale={scale}
              onPageRendered={handlePageRendered} />
          </Document>
        )}
      </div>
    </div>
  );
}
