"use client";

import React, {
  createContext, useContext, useState, useRef, useEffect, useCallback,
} from "react";
import dynamic from "next/dynamic";
import type { Slide } from "@/app/api/convert/route";
import AssignmentViewer from "./AssignmentViewer";

const PDFViewer = dynamic(() => import("./CampusPDFViewer"), { ssr: false });

// ─── Public types & context ───────────────────────────────────────────────────

export type PanelKind = "pdf" | "docx" | "xlsx" | "pptx" | "text";

export interface PanelEntry {
  kind: PanelKind;
  proxyUrl: string;  // /api/files?url=...&inline=1  (DOCX / XLSX fetch source)
  fileUrl: string;   // original Moodle URL           (/api/convert source)
  name: string;
}

/** Tarea abierta en el panel derecho (en paralelo al visor de archivos). */
export interface AssignmentEntry {
  url: string;   // mod/assign/view.php?id=…
  name: string;
  key: string;   // identidad para toggle (la url del módulo)
}

export interface PanelCtx {
  openPanel: (entry: PanelEntry) => void;
  closePanel: () => void;
  activeKey: string | null; // fileUrl of the currently open file
  openAssignment: (entry: AssignmentEntry) => void;
  closeAssignment: () => void;
  activeAssignmentKey: string | null;
}

export const PanelContext = createContext<PanelCtx>({
  openPanel: () => {},
  closePanel: () => {},
  activeKey: null,
  openAssignment: () => {},
  closeAssignment: () => {},
  activeAssignmentKey: null,
});

/** Hook for any FileViewer nested inside WorkspaceLayout */
export function usePdfPreview(): PanelCtx {
  return useContext(PanelContext);
}

// ─── Aspect ratios for column-width calculation ───────────────────────────────

const KIND_RATIOS: Record<PanelKind, number> = {
  pdf:  0.71, // overridden by onAspectRatio callback from CampusPDFViewer
  docx: 0.71,
  pptx: 1.78,
  xlsx: 1.4,
  text: 0.71,
};

// ─── Panel internal loading state ─────────────────────────────────────────────

type PanelState =
  | { phase: "loading"; label: string }
  | { phase: "error"; msg: string }
  | { phase: "pdf"; url: string }
  | { phase: "docx"; buffer: ArrayBuffer }
  | { phase: "xlsx"; buffer: ArrayBuffer }
  | { phase: "slides"; slides: Slide[] }
  | { phase: "text"; text: string };

// ─── DOCX viewer (docx-preview client-side) ───────────────────────────────────

function DocxViewer({ buffer, initialScale = 1.0 }: { buffer: ArrayBuffer; initialScale?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [scale, setScale] = useState(initialScale);

  useEffect(() => {
    if (!ref.current) return;
    setDone(false); setErr("");
    import("docx-preview")
      .then(({ renderAsync }) =>
        renderAsync(buffer, ref.current!, undefined, {
          inWrapper: true, ignoreWidth: false, ignoreHeight: false,
          renderHeaders: true, renderFooters: true, useBase64URL: true, breakPages: true,
        })
      )
      .then(() => setDone(true))
      .catch((e) => setErr((e as Error).message));
  }, [buffer]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: "#525659" }}>
      <div className="flex items-center justify-end gap-0.5 px-2 shrink-0 border-b border-black/30" style={{ background: "#38383d", height: 36 }}>
        <button
          onClick={() => setScale((s) => Math.max(0.5, parseFloat((s - 0.1).toFixed(2))))}
          className="flex items-center justify-center h-7 w-7 rounded text-white/90 hover:bg-white/[0.12]"
          title="Alejar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <span className="text-white/80 text-[12px] tabular-nums select-none" style={{ minWidth: 48, textAlign: "center" }}>
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={() => setScale((s) => Math.min(2, parseFloat((s + 0.1).toFixed(2))))}
          className="flex items-center justify-center h-7 w-7 rounded text-white/90 hover:bg-white/[0.12]"
          title="Acercar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {!done && !err && (
          <div className="flex items-center justify-center gap-2 h-24">
            <div className="w-4 h-4 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
            <span className="text-[12px] text-white/60">Renderizando documento…</span>
          </div>
        )}
        {err && <p className="text-[#ff6b6b] text-[13px] p-4">{err}</p>}
        <div className={done ? "" : "hidden"} style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}>
          <div ref={ref} />
        </div>
      </div>
    </div>
  );
}

// ─── XLSX viewer (SheetJS client-side) ────────────────────────────────────────

function XlsxViewer({ buffer }: { buffer: ArrayBuffer }) {
  type CellData = { v: string; right: boolean };
  type Sheet = { name: string; cols: string[]; rows: { num: number; cells: CellData[] }[] };

  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [active, setActive] = useState(0);
  const [err, setErr] = useState("");

  useEffect(() => {
    import("xlsx").then((XLSX) => {
      const wb = XLSX.read(buffer, { type: "array" });
      const parsed: Sheet[] = wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name];
        if (!ws["!ref"]) return { name, cols: [], rows: [] };
        const range = XLSX.utils.decode_range(ws["!ref"]);
        const cols: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) cols.push(XLSX.utils.encode_col(c));
        const rows = [];
        for (let r = range.s.r; r <= range.e.r; r++) {
          const cells: CellData[] = [];
          for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            cells.push({ v: cell ? XLSX.utils.format_cell(cell) : "", right: cell?.t === "n" });
          }
          rows.push({ num: r + 1, cells });
        }
        return { name, cols, rows };
      });
      setSheets(parsed);
    }).catch((e) => setErr((e as Error).message));
  }, [buffer]);

  if (err) return <p className="text-[#ff6b6b] text-[13px] p-4">{err}</p>;
  if (!sheets.length) return (
    <div className="flex items-center justify-center gap-2 h-24">
      <div className="w-4 h-4 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
      <span className="text-[12px] text-white/60">Cargando hoja…</span>
    </div>
  );

  const sheet = sheets[active];
  const HEAD = "#2d2d30"; const ROW = "#1e1e1e"; const BORDER = "rgba(255,255,255,0.1)";

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: "#1e1e1e" }}>
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex gap-0 shrink-0 border-b overflow-x-auto" style={{ borderColor: BORDER, background: "#252526" }}>
          {sheets.map((s, i) => (
            <button key={i} onClick={() => setActive(i)}
              className="px-4 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors"
              style={{
                background: i === active ? "#1e1e1e" : "transparent",
                color: i === active ? "#fff" : "rgba(255,255,255,0.5)",
                borderTop: i === active ? "2px solid #007aff" : "2px solid transparent",
              }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      {/* Grid */}
      <div className="overflow-auto flex-1">
        <table style={{ borderCollapse: "collapse", fontSize: "12px", color: "#d4d4d4" }}>
          <thead>
            <tr>
              <th style={{ background: HEAD, border: `1px solid ${BORDER}`, padding: "3px 8px", position: "sticky", top: 0, left: 0, zIndex: 3, minWidth: 40, fontWeight: 600 }}>#</th>
              {sheet.cols.map((c) => (
                <th key={c} style={{ background: HEAD, border: `1px solid ${BORDER}`, padding: "3px 12px", position: "sticky", top: 0, zIndex: 2, fontWeight: 600, textAlign: "center" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row) => (
              <tr key={row.num}>
                <td style={{ background: HEAD, border: `1px solid ${BORDER}`, padding: "3px 8px", position: "sticky", left: 0, zIndex: 1, textAlign: "right", color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>{row.num}</td>
                {row.cells.map((cell, ci) => (
                  <td key={ci} style={{ background: ROW, border: `1px solid ${BORDER}`, padding: "3px 12px", textAlign: cell.right ? "right" : "left", whiteSpace: "nowrap" }}>{cell.v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Slides viewer (PPTX) ─────────────────────────────────────────────────────

function SlideViewer({ slides }: { slides: Slide[] }) {
  const [idx, setIdx] = useState(0);

  if (!slides.length) return <p className="text-white/40 text-[13px] text-center py-8">Sin contenido.</p>;

  const slide = slides[idx];
  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: "#0d0f14" }}>
      {/* 16:9 canvas */}
      <div className="flex-1 flex items-center justify-center p-3">
        <div style={{ width: "100%", aspectRatio: "16/9", position: "relative", background: "linear-gradient(140deg,#0f1923,#1a2332)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#007aff,#5ac8fa)" }} />
          <div style={{ position: "absolute", inset: "14px 32px 24px 20px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
            {slide.paragraphs.length === 0
              ? <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, textAlign: "center" }}>Diapositiva sin texto.</p>
              : <>
                <h2 style={{ color: "#fff", fontSize: "clamp(12px,3vw,20px)", fontWeight: 700, lineHeight: 1.2, margin: 0, textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}>{slide.paragraphs[0]}</h2>
                {slide.paragraphs.length > 1 && <div style={{ width: 28, height: 2, background: "#007aff", borderRadius: 1 }} />}
                {slide.paragraphs.slice(1).map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <span style={{ color: "#5ac8fa", fontSize: "clamp(8px,1.5vw,11px)", marginTop: 1, flexShrink: 0 }}>•</span>
                    <p style={{ color: "rgba(210,230,255,0.82)", fontSize: "clamp(8px,1.5vw,11px)", lineHeight: 1.45, margin: 0 }}>{p}</p>
                  </div>
                ))}
              </>}
          </div>
          <div style={{ position: "absolute", bottom: 6, right: 10, color: "rgba(255,255,255,0.2)", fontSize: 9 }}>{idx + 1} / {slides.length}</div>
          {idx > 0 && <NavBtn dir="left" onClick={() => setIdx(i => i - 1)} />}
          {idx < slides.length - 1 && <NavBtn dir="right" onClick={() => setIdx(i => i + 1)} />}
        </div>
      </div>
      {/* Thumbnail strip */}
      {slides.length > 1 && (
        <div style={{ display: "flex", gap: 5, padding: "6px 8px", overflowX: "auto", background: "#161b22", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          {slides.map((s, i) => (
            <button key={i} onClick={() => setIdx(i)}
              style={{ flexShrink: 0, width: 56, height: 36, borderRadius: 4, border: `2px solid ${i === idx ? "#007aff" : "rgba(255,255,255,0.08)"}`, background: "linear-gradient(140deg,#0f1923,#1a2332)", padding: "3px 4px", cursor: "pointer", position: "relative", overflow: "hidden" }}>
              <div style={{ width: "100%", height: 2, background: "linear-gradient(90deg,#007aff,#5ac8fa)", marginBottom: 2 }} />
              <span style={{ color: i === idx ? "#60b3ff" : "rgba(255,255,255,0.4)", fontSize: "4.5px", fontWeight: 700, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as React.CSSProperties}>
                {s.paragraphs[0] ?? `Slide ${s.index}`}
              </span>
              <span style={{ position: "absolute", bottom: 2, right: 2, color: "rgba(255,255,255,0.2)", fontSize: 4 }}>{i + 1}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NavBtn({ dir, onClick }: { dir: "left" | "right"; onClick: () => void }) {
  const side = dir === "left" ? { left: 5 } : { right: 5 };
  return (
    <button onClick={onClick} style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", ...side, width: 24, height: 24, borderRadius: "50%", background: "rgba(255,255,255,0.13)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
        {dir === "left" ? <polyline points="15,18 9,12 15,6" /> : <polyline points="9,18 15,12 9,6" />}
      </svg>
    </button>
  );
}

// ─── Text viewer ──────────────────────────────────────────────────────────────

function TextViewer({ text }: { text: string }) {
  const isHtml = /<[a-z][\s\S]*>/i.test(text.slice(0, 500));
  if (isHtml) return <iframe srcDoc={text} title="Vista HTML" sandbox="allow-same-origin" className="flex-1 border-0 w-full" />;
  return (
    <pre className="flex-1 overflow-auto p-4 text-[12px] text-[#d4d4d4] leading-relaxed whitespace-pre-wrap break-words"
      style={{ fontFamily: "'SF Mono','Menlo',monospace", background: "#1e1e1e" }}>
      {text}
    </pre>
  );
}

// ─── Panel content loader ─────────────────────────────────────────────────────

function PanelContent({ entry, onAspectRatio, xlsxMode, initialScale = 1.0 }: {
  entry: PanelEntry;
  onAspectRatio: (r: number) => void;
  xlsxMode: "pdf" | "excel";
  initialScale?: number;
}) {
  const [ps, setPs] = useState<PanelState>({ phase: "loading", label: "Cargando…" });
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    setPs({ phase: "loading", label: "Cargando…" });
    let cancelled = false;

    async function load() {
      try {
        if (entry.kind === "pdf") {
          if (!cancelled) setPs({ phase: "pdf", url: entry.proxyUrl });
          return;
        }

        if (entry.kind === "docx") {
          setPs({ phase: "loading", label: "Descargando documento…" });
          const res = await fetch(entry.proxyUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          if (!cancelled) setPs({ phase: "docx", buffer: buf });
          return;
        }

        // Modo tabla nativa para XLSX
        if (entry.kind === "xlsx" && xlsxMode === "excel") {
          setPs({ phase: "loading", label: "Cargando hoja de cálculo…" });
          const res = await fetch(entry.proxyUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          if (!cancelled) setPs({ phase: "xlsx", buffer: buf });
          return;
        }

        if (entry.kind === "xlsx" || entry.kind === "pptx") {
          setPs({ phase: "loading", label: "Descargando archivo…" });
          const fileRes = await fetch(entry.proxyUrl);
          if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
          const fileBlob = await fileRes.blob();

          setPs({ phase: "loading", label: "Convirtiendo a PDF…" });
          const fd = new FormData();
          fd.append("file", new File([fileBlob], `file.${entry.kind}`));
          const r = await fetch("/api/convert", { method: "POST", body: fd });
          if (!r.ok) {
            const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
            throw new Error(err.error ?? `HTTP ${r.status}`);
          }
          const pdfBlob = await r.blob();
          const url = URL.createObjectURL(pdfBlob);
          if (cancelled) { URL.revokeObjectURL(url); return; }
          blobUrlRef.current = url;
          setPs({ phase: "pdf", url });
          return;
        }

        if (entry.kind === "text") {
          setPs({ phase: "loading", label: "Cargando texto…" });
          const res = await fetch(entry.proxyUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          if (!cancelled) setPs({ phase: "text", text });
          return;
        }
      } catch (e) {
        if (!cancelled) setPs({ phase: "error", msg: (e as Error).message });
      }
    }

    load();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [entry.kind, entry.proxyUrl, entry.fileUrl, xlsxMode]);

  if (ps.phase === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center gap-2.5" style={{ background: "#525659" }}>
        <div className="w-4 h-4 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
        <span className="text-[13px] text-white/60">{ps.label}</span>
      </div>
    );
  }

  if (ps.phase === "error") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6" style={{ background: "#525659" }}>
        <p className="text-[#ff6b6b] text-[14px]">No se pudo cargar</p>
        <p className="text-[rgba(255,107,107,0.6)] text-[12px] text-center">{ps.msg}</p>
        <a href={`/api/files?url=${encodeURIComponent(entry.fileUrl)}`}
          className="mt-2 px-4 py-2 bg-white/10 text-white text-[12px] rounded-lg hover:bg-white/20 transition-colors">
          Descargar
        </a>
      </div>
    );
  }

  if (ps.phase === "pdf") return (
    <div className="flex-1 overflow-hidden">
      <PDFViewer src={ps.url} maxHeight="100%" onAspectRatio={onAspectRatio} initialScale={initialScale} />
    </div>
  );

  if (ps.phase === "docx") return <DocxViewer buffer={ps.buffer} initialScale={initialScale} />;
  if (ps.phase === "xlsx") return <XlsxViewer buffer={ps.buffer} />;
  if (ps.phase === "slides") return <SlideViewer slides={ps.slides} />;
  if (ps.phase === "text") return <TextViewer text={ps.text} />;

  return null;
}

// ─── Panel header icon button ─────────────────────────────────────────────────

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      className="flex items-center justify-center w-7 h-7 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0">
      {children}
    </button>
  );
}

// ─── WorkspaceLayout ──────────────────────────────────────────────────────────

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<PanelEntry | null>(null);
  const [assignment, setAssignment] = useState<AssignmentEntry | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobileView, setIsMobileView] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 1023px)").matches : false
  );
  const [isMobileOverlayOpen, setIsMobileOverlayOpen] = useState(false);
  const [xlsxMode, setXlsxMode] = useState<"pdf" | "excel">("excel");
  const panelRef = useRef<HTMLDivElement>(null);

  const openPanel = useCallback((entry: PanelEntry) => {
    // Abrir un archivo NO cierra la tarea: si hay tarea abierta, se pasa al
    // modo dividido (tarea a la izquierda, preview a la derecha).
    setActive((prev) => {
      if (prev?.fileUrl === entry.fileUrl) return null; // toggle
      setAspectRatio(KIND_RATIOS[entry.kind]);
      setXlsxMode("excel"); // siempre empieza en Excel al abrir un nuevo archivo
      return entry;
    });
    if (isMobileView) setIsMobileOverlayOpen(true);
  }, [isMobileView]);

  const openAssignment = useCallback((entry: AssignmentEntry) => {
    setActive(null); // abrir una tarea cierra el visor de archivos
    setAspectRatio(null);
    setAssignment((prev) => (prev?.key === entry.key ? null : entry)); // toggle
    if (isMobileView) setIsMobileOverlayOpen(true);
  }, [isMobileView]);

  const closeAssignment = useCallback(() => setAssignment(null), []);

  const toggleXlsxMode = useCallback(() => {
    setXlsxMode((m) => {
      const next = m === "pdf" ? "excel" : "pdf";
      if (next === "excel") setAspectRatio(KIND_RATIOS.xlsx);
      return next;
    });
  }, []);

  const closePanel = useCallback(() => { setActive(null); setAspectRatio(null); }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobileView(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener("change", update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", update);
      else mq.removeListener(update);
    };
  }, []);

  useEffect(() => {
    if (!isMobileOverlayOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = original; };
  }, [isMobileOverlayOpen]);

  useEffect(() => {
    if (!active && !assignment) setIsMobileOverlayOpen(false);
  }, [active, assignment]);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else panelRef.current?.requestFullscreen().catch(() => {});
  }

  const taskOpen = !!assignment;
  const fileOpen = !!active;
  const splitTaskFile = taskOpen && fileOpen; // tarea a la izquierda + preview a la derecha

  // Ancho del visor de archivo según relación de aspecto del documento.
  const rightFlexFile = active
    ? Math.max(0.6, Math.min(1.8, aspectRatio ?? KIND_RATIOS[active.kind]))
    : 0.9;

  const isPanelOpen = taskOpen || fileOpen;
  const panelTop = 96;

  const assignmentShell = (
    <AssignmentViewer
      url={assignment?.url ?? ""}
      name={assignment?.name ?? ""}
      onClose={closeAssignment}
    />
  );

  const panelHeader = (isOverlay: boolean) => (
    <div className="flex items-center gap-2 px-3 shrink-0" style={{ background: "#2d2d30", height: 36 }}>
      <div className="w-2 h-2 rounded-full bg-[#007aff] shrink-0" />
      <p className="flex-1 min-w-0 text-white/80 text-[12px] font-medium truncate" title={active?.name}>
        {active?.name}
      </p>
      {active?.kind === "xlsx" && (
        <IconBtn onClick={toggleXlsxMode} title={xlsxMode === "pdf" ? "Ver como tabla Excel" : "Ver como PDF"}>
          {xlsxMode === "pdf" ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" />
            </svg>
          )}
        </IconBtn>
      )}
      {isOverlay ? (
        <IconBtn onClick={() => setIsMobileOverlayOpen(false)} title="Minimizar visor">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="6" y1="12" x2="18" y2="12" />
          </svg>
        </IconBtn>
      ) : (
        <IconBtn onClick={toggleFullscreen} title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}>
          {isFullscreen ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <polyline points="8,3 3,3 3,8" /><polyline points="21,8 21,3 16,3" />
              <polyline points="3,16 3,21 8,21" /><polyline points="16,21 21,21 21,16" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <polyline points="15,3 21,3 21,9" /><polyline points="9,21 3,21 3,15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </IconBtn>
      )}
      <IconBtn onClick={closePanel} title="Cerrar visor">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </IconBtn>
    </div>
  );

  const panelShell = (isOverlay: boolean) => (
    <div className={isOverlay ? "flex flex-col h-full rounded-none overflow-hidden shadow-2xl" : "flex flex-col h-full rounded-2xl overflow-hidden shadow-2xl"}>
      {panelHeader(isOverlay)}
      <PanelContent
        key={active?.fileUrl}
        entry={active as PanelEntry}
        onAspectRatio={setAspectRatio}
        xlsxMode={xlsxMode}
        initialScale={isMobileView ? 0.75 : 1.0}
      />
    </div>
  );

  return (
    <PanelContext.Provider
      value={{
        openPanel,
        closePanel,
        activeKey: active?.fileUrl ?? null,
        openAssignment,
        closeAssignment,
        activeAssignmentKey: assignment?.key ?? null,
      }}
    >
      <div className="max-w-[1600px] mx-auto px-4">
        <div className="flex flex-col lg:flex-row items-start gap-4">

          {/* Índice del curso — se colapsa cuando hay tarea + preview a la vez */}
          <div
            className="min-w-0"
            style={{
              order: 1,
              flex: splitTaskFile ? "0 0 0px" : 1,
              width: isMobileView ? "100%" : undefined,
              transition: "flex 0.38s cubic-bezier(0.4,0,0.2,1)",
              ...(splitTaskFile
                ? { overflow: "hidden", padding: 0, pointerEvents: "none", opacity: 0 }
                : !isMobileView && isPanelOpen
                ? { overflowY: "auto", maxHeight: "calc(100vh - 72px)", minWidth: 260, paddingRight: 10 }
                : {}),
            }}
          >
            <div style={{ maxWidth: isPanelOpen || isMobileView ? "none" : "42rem", margin: "0 auto" }}>
              {children}
            </div>
          </div>

          {/* Tarea — derecha en [Índice|Tarea], izquierda en [Tarea|Preview] */}
          {!isMobileView && taskOpen && (
            <div
              style={{
                order: splitTaskFile ? 0 : 2,
                flex: splitTaskFile ? 1 : 0.95,
                minWidth: 0,
                overflow: "hidden",
                transition: "flex 0.38s cubic-bezier(0.4,0,0.2,1)",
              }}
            >
              <div className="lg:sticky" style={{ top: panelTop, height: `calc(100vh - ${panelTop + 8}px)` }}>
                {assignmentShell}
              </div>
            </div>
          )}

          {/* Preview de archivo — siempre a la derecha (order 3) */}
          {!isMobileView && fileOpen && (
            <div
              style={{
                order: 3,
                flex: splitTaskFile ? 1 : rightFlexFile,
                minWidth: 0,
                overflow: "hidden",
                transition: "flex 0.38s cubic-bezier(0.4,0,0.2,1)",
              }}
            >
              <div
                ref={panelRef}
                className="lg:sticky"
                style={{ top: panelTop, height: `calc(100vh - ${panelTop + 8}px)` }}
              >
                {panelShell(false)}
              </div>
            </div>
          )}

        </div>
      </div>
      {/* Móvil: overlay en primer plano (el preview de archivo tiene prioridad) */}
      {isPanelOpen && isMobileView && isMobileOverlayOpen && (
        <div className="fixed inset-0 z-[100] bg-black/70">
          <div className={`absolute inset-3 rounded-2xl overflow-hidden ${fileOpen ? "bg-[#2d2d30]" : ""}`}>
            {fileOpen ? panelShell(true) : assignmentShell}
          </div>
        </div>
      )}
    </PanelContext.Provider>
  );
}
