"use client";

import { useState, useEffect, useRef } from "react";
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

function TBtn({ onClick, disabled, title, children, minW }: {
  onClick: () => void; disabled?: boolean; title?: string;
  children: React.ReactNode; minW?: number;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`flex items-center justify-center h-8 rounded text-[13px] font-medium transition-colors select-none
        ${disabled ? "text-white/25 cursor-default" : "text-white/90 hover:bg-white/[0.12] cursor-pointer"}`}
      style={{ minWidth: minW ?? 32, padding: "0 6px" }}>
      {children}
    </button>
  );
}

// ─── CampusPDFViewer ──────────────────────────────────────────────────────────

export default function CampusPDFViewer({ src, maxHeight = "75vh", onAspectRatio }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage]         = useState(1);
  const [scale, setScale]       = useState(1.0);
  const [docError, setDocError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const aspectReportedRef = useRef(false); // report only once per document

  // Resolve src → react-pdf file prop, clean up objectURLs
  const [file, setFile] = useState<string | { data: ArrayBuffer } | null>(null);
  useEffect(() => {
    aspectReportedRef.current = false;
    if (src instanceof Blob) {
      const url = URL.createObjectURL(src);
      setFile(url);
      return () => URL.revokeObjectURL(url);
    }
    if (src instanceof ArrayBuffer) { setFile({ data: src }); return undefined; }
    setFile(src);
    return undefined;
  }, [src]);

  // Responsive page width
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setContainerWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = containerWidth > 0 ? Math.floor((containerWidth - 32) * scale) : undefined;

  async function handleDocLoad(pdf: PDFDocumentProxy) {
    setNumPages(pdf.numPages);
    setPage(1);
    if (onAspectRatio && !aspectReportedRef.current) {
      try {
        const pg = await pdf.getPage(1);
        const vp = pg.getViewport({ scale: 1 });
        onAspectRatio(vp.width / vp.height);
        aspectReportedRef.current = true;
      } catch { /* ignore */ }
    }
  }

  function navigate(delta: number) {
    setPage((p) => Math.max(1, Math.min(numPages, p + delta)));
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function zoom(delta: number) {
    setScale((s) => parseFloat(Math.max(0.25, Math.min(4, s + delta)).toFixed(2)));
  }

  if (!file) return null;

  // Fill parent (workspace mode) vs self-contained (standalone mode)
  const containerStyle: React.CSSProperties =
    maxHeight === "100%"
      ? { height: "100%", display: "flex", flexDirection: "column" }
      : { maxHeight, display: "flex", flexDirection: "column" };

  return (
    <div style={containerStyle}>
      {/* ── Toolbar ────────────────────────────────────── */}
      <div className="flex items-center justify-between px-2 shrink-0 border-b border-black/30"
        style={{ background: "#38383d", height: 40 }}>
        <div className="flex items-center gap-0.5">
          <TBtn onClick={() => navigate(-1)} disabled={page <= 1} title="Página anterior">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="15,18 9,12 15,6" />
            </svg>
          </TBtn>
          <span className="text-white/90 text-[13px] tabular-nums text-center select-none" style={{ minWidth: 72 }}>
            {numPages > 0 ? `${page} / ${numPages}` : "—"}
          </span>
          <TBtn onClick={() => navigate(1)} disabled={page >= numPages} title="Página siguiente">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="9,18 15,12 9,6" />
            </svg>
          </TBtn>
        </div>
        <div className="flex items-center gap-0.5">
          <TBtn onClick={() => zoom(-0.25)} disabled={scale <= 0.25} title="Alejar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </TBtn>
          <TBtn onClick={() => setScale(1)} title="Restablecer zoom (100%)" minW={52}>
            {Math.round(scale * 100)}%
          </TBtn>
          <TBtn onClick={() => zoom(0.25)} disabled={scale >= 4} title="Acercar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </TBtn>
        </div>
      </div>

      {/* ── Document area ──────────────────────────────── */}
      <div ref={scrollRef} className="overflow-auto flex-1 flex justify-center p-4" style={{ background: "#525659" }}>
        {docError ? (
          <div className="text-center py-16 px-6">
            <p className="text-[#ff6b6b] text-[14px] mb-2">No se pudo cargar el documento</p>
            <p className="text-[rgba(255,107,107,0.6)] text-[12px]">{docError}</p>
          </div>
        ) : (
          <Document file={file} onLoadSuccess={handleDocLoad}
            onLoadError={(e) => setDocError(e.message)}
            loading={<PageSkeleton />} error={<span />}>
            <Page pageNumber={page} width={pageWidth}
              loading={<PageSkeleton />} renderTextLayer renderAnnotationLayer
              className="shadow-2xl" />
          </Document>
        )}
      </div>
    </div>
  );
}
