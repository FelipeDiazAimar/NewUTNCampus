"use client";

import React, {
  createContext, useContext, useState, useRef, useEffect, useCallback,
} from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import type { Slide } from "@/app/api/convert/route";
import AssignmentViewer from "./AssignmentViewer";

const PDFViewer = dynamic(() => import("./CampusPDFViewer"), { ssr: false });

// ─── Panel theme context ───────────────────────────────────────────────────────

type PanelTheme = "dark" | "light";
const PanelThemeCtx = createContext<PanelTheme>("dark");
const usePanelTheme = () => useContext(PanelThemeCtx);

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
  | { phase: "loading"; label: string; progress?: number; downloaded?: number; total?: number }
  | { phase: "error"; msg: string }
  | { phase: "pdf"; url: string }
  | { phase: "docx"; buffer: ArrayBuffer }
  | { phase: "xlsx"; buffer: ArrayBuffer }
  | { phase: "slides"; slides: Slide[] }
  | { phase: "text"; text: string };

type CachedPanelState = Exclude<PanelState, { phase: "loading" } | { phase: "error" }>;
type FileCache = Map<string, CachedPanelState>;

/** True if the buffer is a ZIP (OOXML .docx/.xlsx/.pptx start with "PK"\x03\x04).
 *  Old binary .doc/.xls/.ppt (OLE, D0 CF 11 E0) return false — they can't be
 *  parsed by the client-side OOXML viewers and must be downloaded instead. */
function isZipBuffer(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return b[0] === 0x50 && b[1] === 0x4b; // "PK"
}

// ─── DOCX viewer (docx-preview client-side) ───────────────────────────────────

function DocxViewer({ buffer, initialScale = 1.0 }: { buffer: ArrayBuffer; initialScale?: number }) {
  const theme = usePanelTheme();
  const light = theme === "light";
  const ref = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [scale, setScale] = useState(initialScale);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let cancelled = false;
    setDone(false); setErr("");
    // Clear any previous docx-preview DOM before re-rendering
    container.innerHTML = "";
    import("docx-preview")
      .then(({ renderAsync }) => {
        if (cancelled) return;
        return renderAsync(buffer, container, undefined, {
          inWrapper: true, ignoreWidth: false, ignoreHeight: false,
          renderHeaders: true, renderFooters: true, useBase64URL: true, breakPages: true,
        });
      })
      .then(() => { if (!cancelled) setDone(true); })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message ?? "Error al renderizar");
      });
    return () => {
      cancelled = true;
      try { container.innerHTML = ""; } catch { /* ignore DOM errors during unmount */ }
    };
  }, [buffer]);

  const toolbarBg  = light ? "#e8e8ed" : "#38383d";
  const panelBg    = light ? "#f2f2f7" : "#525659";
  const btnCls     = light
    ? "flex items-center justify-center h-7 w-7 rounded text-[#1c1c1e]/70 hover:bg-black/10"
    : "flex items-center justify-center h-7 w-7 rounded text-white/90 hover:bg-white/[0.12]";
  const countColor = light ? "text-[#1c1c1e]/60" : "text-white/80";

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: panelBg }}>
      <div className="flex items-center justify-end gap-0.5 px-2 shrink-0 border-b" style={{ background: toolbarBg, height: 36, borderColor: light ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.3)" }}>
        <button onClick={() => setScale((s) => Math.max(0.5, parseFloat((s - 0.1).toFixed(2))))} className={btnCls} title="Alejar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <span className={`text-[12px] tabular-nums select-none ${countColor}`} style={{ minWidth: 48, textAlign: "center" }}>
          {Math.round(scale * 100)}%
        </span>
        <button onClick={() => setScale((s) => Math.min(2, parseFloat((s + 0.1).toFixed(2))))} className={btnCls} title="Acercar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {!done && !err && (
          <div className="flex items-center justify-center gap-2 h-24">
            <div className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${light ? "border-[#1c1c1e]/30" : "border-white/40"}`} />
            <span className={`text-[12px] ${light ? "text-[#1c1c1e]/50" : "text-white/60"}`}>Renderizando documento…</span>
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
  const theme = usePanelTheme();
  const light = theme === "light";
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
      <div className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${light ? "border-[#1c1c1e]/30" : "border-white/40"}`} />
      <span className={`text-[12px] ${light ? "text-[#1c1c1e]/50" : "text-white/60"}`}>Cargando hoja…</span>
    </div>
  );

  const sheet = sheets[active];
  const HEAD   = light ? "#e8e8ed" : "#2d2d30";
  const ROW    = light ? "#ffffff" : "#1e1e1e";
  const BORDER = light ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.1)";
  const TEXT   = light ? "#1c1c1e" : "#d4d4d4";
  const MUTED  = light ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.4)";
  const TABBAR = light ? "#f2f2f7" : "#252526";

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: ROW }}>
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex gap-0 shrink-0 border-b overflow-x-auto" style={{ borderColor: BORDER, background: TABBAR }}>
          {sheets.map((s, i) => (
            <button key={i} onClick={() => setActive(i)}
              className="px-4 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors"
              style={{
                background: i === active ? ROW : "transparent",
                color: i === active ? TEXT : MUTED,
                borderTop: i === active ? "2px solid #007aff" : "2px solid transparent",
              }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      {/* Grid */}
      <div className="overflow-auto flex-1">
        <table style={{ borderCollapse: "collapse", fontSize: "12px", color: TEXT }}>
          <thead>
            <tr>
              <th style={{ background: HEAD, border: `1px solid ${BORDER}`, padding: "3px 8px", position: "sticky", top: 0, left: 0, zIndex: 3, minWidth: 40, fontWeight: 600, color: MUTED }}>#</th>
              {sheet.cols.map((c) => (
                <th key={c} style={{ background: HEAD, border: `1px solid ${BORDER}`, padding: "3px 12px", position: "sticky", top: 0, zIndex: 2, fontWeight: 600, textAlign: "center", color: TEXT }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row) => (
              <tr key={row.num}>
                <td style={{ background: HEAD, border: `1px solid ${BORDER}`, padding: "3px 8px", position: "sticky", left: 0, zIndex: 1, textAlign: "right", color: MUTED, fontWeight: 600 }}>{row.num}</td>
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
  const theme = usePanelTheme();
  const light = theme === "light";
  const [idx, setIdx] = useState(0);

  if (!slides.length) return <p className={`text-[13px] text-center py-8 ${light ? "text-[#1c1c1e]/40" : "text-white/40"}`}>Sin contenido.</p>;

  const slide = slides[idx];
  const outerBg   = light ? "#e8e8ed" : "#0d0f14";
  const stripBg   = light ? "#d8d8dd" : "#161b22";
  const stripBord = light ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";
  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: outerBg }}>
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
        <div style={{ display: "flex", gap: 5, padding: "6px 8px", overflowX: "auto", background: stripBg, borderTop: `1px solid ${stripBord}`, flexShrink: 0 }}>
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
  const light = usePanelTheme() === "light";
  const isHtml = /<[a-z][\s\S]*>/i.test(text.slice(0, 500));
  if (isHtml) return <iframe srcDoc={text} title="Vista HTML" sandbox="allow-same-origin" className="flex-1 border-0 w-full" />;
  return (
    <pre className="flex-1 overflow-auto p-4 text-[12px] leading-relaxed whitespace-pre-wrap break-words"
      style={{ fontFamily: "'SF Mono','Menlo',monospace", background: light ? "#f8f8fa" : "#1e1e1e", color: light ? "#1c1c1e" : "#d4d4d4" }}>
      {text}
    </pre>
  );
}

// ─── Native fallback when Drive is unavailable ───────────────────────────────

async function nativeFallback(
  entry: PanelEntry,
  setPs: (s: PanelState) => void,
  cancelled: boolean,
  cache?: (s: CachedPanelState) => void
) {
  if (entry.kind === "pptx") {
    setPs({ phase: "loading", label: "Cargando presentación…" });
    const res = await fetch(`/api/convert?url=${encodeURIComponent(entry.fileUrl)}&filename=file.pptx`);
    if (!res.ok) { setPs({ phase: "error", msg: `HTTP ${res.status}` }); return; }
    const data = await res.json();
    if (!cancelled && data.kind === "slides") {
      const s: CachedPanelState = { phase: "slides", slides: data.slides };
      cache?.(s); setPs(s);
    }
    return;
  }
  if (entry.kind === "xlsx") {
    setPs({ phase: "loading", label: "Cargando hoja de cálculo…" });
    const res = await fetch(entry.proxyUrl);
    if (!res.ok) { setPs({ phase: "error", msg: `HTTP ${res.status}` }); return; }
    const buf = await res.arrayBuffer();
    if (!cancelled) {
      const s: CachedPanelState = { phase: "xlsx", buffer: buf };
      cache?.(s); setPs(s);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function streamDownload(url: string, onProgress: (downloaded: number, total: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = parseInt(res.headers.get("content-length") ?? "0");
  if (!res.body || total === 0) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    onProgress(downloaded, total);
  }
  const buf = new Uint8Array(downloaded);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.length; }
  return buf.buffer;
}

// ─── Panel content loader ─────────────────────────────────────────────────────

function PanelContent({ entry, onAspectRatio, xlsxMode, initialScale = 1.0, fileCache }: {
  entry: PanelEntry;
  onAspectRatio: (r: number) => void;
  xlsxMode: "pdf" | "excel";
  initialScale?: number;
  fileCache: React.RefObject<FileCache>;
}) {
  const [ps, setPs] = useState<PanelState>(() =>
    fileCache.current?.get(entry.fileUrl) ?? { phase: "loading", label: "Cargando…" }
  );
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const cacheKey = entry.fileUrl;

    // Cache hit — state was already initialized correctly, nothing to do
    if (fileCache.current?.has(cacheKey)) return;

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    setPs({ phase: "loading", label: "Cargando…" });
    let cancelled = false;

    const cache = (state: CachedPanelState) => {
      fileCache.current?.set(cacheKey, state);
    };

    // Upload the file to Google Drive, convert it to PDF, and stream progress.
    // Used for modern OOXML (xlsx/pptx) and legacy binary Office (doc/xls/ppt).
    // Returns true if a PDF was produced; false if Drive was unavailable/failed.
    async function runDriveConvert(ext: string): Promise<boolean> {
      setPs({ phase: "loading", label: "Preparando archivo…", progress: 0 });
      const fd = new FormData();
      fd.append("url", entry.fileUrl);
      fd.append("kind", ext);
      const r = await fetch("/api/convert", { method: "POST", body: fd });
      if (!r?.ok || !r?.body) return false;

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let sseBuf = "";
      let lastTotal: number | undefined;
      let lastDownloaded: number | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuf += decoder.decode(value, { stream: true });
        const parts = sseBuf.split("\n\n");
        sseBuf = parts.pop() ?? "";
        for (const chunk of parts) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let data: { progress?: number; label?: string; pdf?: string; error?: string; downloaded?: number; total?: number };
          try { data = JSON.parse(line.slice(6)); } catch { continue; }

          if (data.error) return false;
          if (data.total !== undefined) lastTotal = data.total;
          if (data.downloaded !== undefined) lastDownloaded = data.downloaded;
          if (data.progress !== undefined && !cancelled)
            setPs({ phase: "loading", label: data.label ?? "", progress: data.progress, downloaded: lastDownloaded, total: lastTotal });
          if (data.pdf && !cancelled) {
            const bytes = Uint8Array.from(atob(data.pdf), (c) => c.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
            if (cancelled) { URL.revokeObjectURL(url); return true; }
            const s: CachedPanelState = { phase: "pdf", url }; // blob URL owned by cache
            cache(s); setPs(s);
            return true;
          }
        }
      }
      return false;
    }

    async function load() {
      // Real filename extension — distinguishes legacy binary Office (.doc/.xls/.ppt,
      // which no JS viewer can read) from modern OOXML (.docx/.xlsx/.pptx).
      const fileExt = entry.name.split(".").pop()?.toLowerCase() ?? "";
      const isLegacyOffice = fileExt === "doc" || fileExt === "xls" || fileExt === "ppt";
      try {
        if (entry.kind === "pdf") {
          // Pass URL directly — PDF.js streams via range requests and surfaces
          // auth errors through its own onLoadError callback.
          const state: CachedPanelState = { phase: "pdf", url: entry.proxyUrl };
          if (!cancelled) { cache(state); setPs(state); }
          return;
        }

        // Legacy binary Office (.doc/.xls/.ppt) → convert to PDF via Google Drive,
        // since no client-side JS viewer can read the old OLE format. If Drive isn't
        // connected/fails, show the download fallback.
        if (isLegacyOffice) {
          if (await runDriveConvert(fileExt)) return;
          if (!cancelled) setPs({ phase: "error", msg: `Este formato (.${fileExt}) requiere Google Drive para previsualizarse. Descargalo para abrirlo.` });
          return;
        }

        if (entry.kind === "docx") {
          setPs({ phase: "loading", label: "Descargando documento…" });
          const buf = await streamDownload(entry.proxyUrl, (dl, tot) => {
            if (!cancelled) setPs({ phase: "loading", label: "Descargando documento…", progress: Math.min(99, Math.round((dl / tot) * 100)), downloaded: dl, total: tot });
          });
          if (cancelled) return;
          // Safety net: if a file slipped through with a .docx name but is actually a
          // legacy OLE binary (not a "PK" ZIP), docx-preview would throw "childNodes"/
          // "body". Send it through Drive instead, falling back to download.
          if (!isZipBuffer(buf)) {
            if (await runDriveConvert("doc")) return;
            if (!cancelled) setPs({ phase: "error", msg: "Este formato no se puede previsualizar. Descargalo para abrirlo." });
            return;
          }
          const s: CachedPanelState = { phase: "docx", buffer: buf }; cache(s); setPs(s);
          return;
        }

        // Modo tabla nativa para XLSX
        if (entry.kind === "xlsx" && xlsxMode === "excel") {
          setPs({ phase: "loading", label: "Cargando hoja de cálculo…" });
          const buf = await streamDownload(entry.proxyUrl, (dl, tot) => {
            if (!cancelled) setPs({ phase: "loading", label: "Cargando hoja de cálculo…", progress: Math.min(99, Math.round((dl / tot) * 100)), downloaded: dl, total: tot });
          });
          if (!cancelled) { const s: CachedPanelState = { phase: "xlsx", buffer: buf }; cache(s); setPs(s); }
          return;
        }

        if (entry.kind === "xlsx" || entry.kind === "pptx") {
          if (await runDriveConvert(entry.kind)) return;
          // Drive unavailable/failed — fall back to the native client-side viewer.
          await nativeFallback(entry, setPs, cancelled, cache);
          return;
        }

        if (entry.kind === "text") {
          setPs({ phase: "loading", label: "Cargando texto…" });
          const res = await fetch(entry.proxyUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          if (!cancelled) { const s: CachedPanelState = { phase: "text", text }; cache(s); setPs(s); }
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
    const light = usePanelTheme() === "light";
    const bg        = light ? "#f2f2f7" : "#525659";
    const trackBg   = light ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.15)";
    const labelClr  = light ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.55)";
    const pctClr    = light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.70)";
    const sizeClr   = light ? "rgba(0,0,0,0.30)" : "rgba(255,255,255,0.35)";
    const spinClr   = light ? "border-[#1c1c1e]/30" : "border-white/40";
    const spinTxt   = light ? "text-[#1c1c1e]/50" : "text-white/60";
    const hasProgress = ps.progress !== undefined;
    const done100     = ps.progress === 100;
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ background: bg }}>
        {hasProgress ? (
          <div className="w-56 flex flex-col gap-2">
            {ps.label && (
              <span className="text-[12px] truncate" style={{ color: labelClr }}>{ps.label}</span>
            )}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: trackBg }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${ps.progress}%`, background: done100 ? "#30d158" : "#007aff" }}
                />
              </div>
              <span className="text-[12px] tabular-nums font-medium shrink-0" style={{ color: pctClr }}>{ps.progress}%</span>
            </div>
            {ps.total !== undefined && ps.total > 0 && (
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] tabular-nums" style={{ color: sizeClr }}>
                  {ps.downloaded !== undefined ? formatBytes(ps.downloaded) : "—"}
                </span>
                <div className="flex items-center gap-1">
                  {ps.downloaded !== undefined && ps.downloaded >= ps.total && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#30d158" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="7,12 10,15 17,9" />
                    </svg>
                  )}
                  <span className="text-[11px] tabular-nums" style={{ color: sizeClr }}>{formatBytes(ps.total)}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className={`w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${spinClr}`} />
            <span className={`text-[13px] ${spinTxt}`}>{ps.label}</span>
          </div>
        )}
      </div>
    );
  }

  if (ps.phase === "error") {
    const light = usePanelTheme() === "light";
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6" style={{ background: light ? "#f2f2f7" : "#525659" }}>
        <p className="text-[#ff6b6b] text-[14px]">No se pudo cargar</p>
        <p className="text-[rgba(255,107,107,0.6)] text-[12px] text-center">{ps.msg}</p>
        <a href={`/api/files?url=${encodeURIComponent(entry.fileUrl)}`}
          className={`mt-2 px-4 py-2 text-[12px] rounded-lg transition-colors ${light ? "bg-black/10 text-[#1c1c1e] hover:bg-black/15" : "bg-white/10 text-white hover:bg-white/20"}`}>
          Descargar
        </a>
      </div>
    );
  }

  if (ps.phase === "pdf") {
    const light = usePanelTheme() === "light";
    return (
      <div className="flex-1 overflow-hidden">
        <PDFViewer src={ps.url} maxHeight="100%" onAspectRatio={onAspectRatio} initialScale={initialScale} lightPanel={light} />
      </div>
    );
  }

  if (ps.phase === "docx") return <DocxViewer buffer={ps.buffer} initialScale={initialScale} />;
  if (ps.phase === "xlsx") return <XlsxViewer buffer={ps.buffer} />;
  if (ps.phase === "slides") return <SlideViewer slides={ps.slides} />;
  if (ps.phase === "text") return <TextViewer text={ps.text} />;

  return null;
}

// ─── Panel header icon button ─────────────────────────────────────────────────

function IconBtn({ onClick, title, children, light }: { onClick: () => void; title: string; children: React.ReactNode; light?: boolean }) {
  return (
    <button onClick={onClick} title={title}
      className={`flex items-center justify-center w-7 h-7 rounded transition-colors shrink-0 ${
        light
          ? "text-[#1c1c1e]/50 hover:text-[#1c1c1e] hover:bg-black/10"
          : "text-white/60 hover:text-white hover:bg-white/10"
      }`}>
      {children}
    </button>
  );
}

// ─── WorkspaceLayout ──────────────────────────────────────────────────────────

export default function WorkspaceLayout({ children, courseTitle }: { children: React.ReactNode; courseTitle?: string }) {
  const [active, setActive] = useState<PanelEntry | null>(null);
  const [assignment, setAssignment] = useState<AssignmentEntry | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const fileCache = useRef<FileCache>(new Map());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSubFullscreen, setIsSubFullscreen] = useState(false);
  const { resolvedTheme } = useTheme();
  const lightPanel = resolvedTheme === "light";
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

  const closePanel = useCallback(() => { setActive(null); setAspectRatio(null); setIsSubFullscreen(false); }, []);

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

  useEffect(() => {
    if (active) {
      document.title = active.name; // name already includes .ext from FileViewer
    } else if (courseTitle) {
      document.title = courseTitle;
    }
  }, [active, courseTitle]);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else panelRef.current?.requestFullscreen().catch(() => {});
  }

  async function handleSaveAs() {
    if (!active) return;
    const filename = active.name;
    const url = `/api/files?url=${encodeURIComponent(active.fileUrl)}`;
    try {
      const picker = (window as Window & { showSaveFilePicker?: (o: object) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }> }).showSaveFilePicker;
      if (!picker) throw new Error("not supported");
      const handle = await picker({ suggestedName: filename, types: [{ description: "Archivo", accept: { "*/*": [`.${active.kind}`] } }] });
      const res = await fetch(url);
      const blob = await res.blob();
      const wr = await handle.createWritable();
      await wr.write(blob);
      await wr.close();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
    }
  }

  function toggleSubFullscreen() {
    setIsSubFullscreen((v) => !v);
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

  const headerBg   = lightPanel ? "#e8e8ed" : "#2d2d30";
  const headerText = lightPanel ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.80)";
  const dotBg      = lightPanel ? "#007aff" : "#007aff";

  const panelHeader = (isOverlay: boolean) => (
    <div className="flex items-center gap-2 px-3 shrink-0" style={{ background: headerBg, height: 36, borderBottom: lightPanel ? "1px solid rgba(0,0,0,0.08)" : "none" }}>
      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: dotBg }} />
      <p className="flex-1 min-w-0 text-[12px] font-medium truncate" style={{ color: headerText }} title={active?.name}>
        {active?.name}
      </p>

      {active?.kind === "xlsx" && (
        <IconBtn light={lightPanel} onClick={toggleXlsxMode} title={xlsxMode === "pdf" ? "Ver como tabla Excel" : "Ver como PDF"}>
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

      {active && (
        <>
          {/* Quick download (to default Downloads folder) */}
          <a
            href={`/api/files?url=${encodeURIComponent(active.fileUrl)}`}
            download={active.name}
            title="Descargar"
            onClick={(e) => e.stopPropagation()}
            className={`flex items-center justify-center w-7 h-7 rounded transition-colors shrink-0 ${lightPanel ? "text-[#1c1c1e]/50 hover:text-[#1c1c1e] hover:bg-black/10" : "text-white/60 hover:text-white hover:bg-white/10"}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>
          {/* Save As (choose location) */}
          <IconBtn light={lightPanel} onClick={handleSaveAs} title="Guardar como…">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              <polyline points="12,11 12,17"/>
              <polyline points="9,14 12,17 15,14"/>
            </svg>
          </IconBtn>
        </>
      )}

      {isOverlay ? (
        <IconBtn light={lightPanel} onClick={() => setIsMobileOverlayOpen(false)} title="Minimizar visor">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="6" y1="12" x2="18" y2="12" />
          </svg>
        </IconBtn>
      ) : (
        <>
          {/* Sub pantalla completa: ocupa toda la ventana del navegador sin F11 */}
          <IconBtn light={lightPanel} onClick={toggleSubFullscreen} title={isSubFullscreen ? "Salir de sub pantalla completa" : "Sub pantalla completa"}>
            {isSubFullscreen ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <polyline points="8,3 3,3 3,8" /><polyline points="21,8 21,3 16,3" />
                <polyline points="3,16 3,21 8,21" /><polyline points="16,21 21,21 21,16" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <polyline points="9,3 3,3 3,9" /><polyline points="15,3 21,3 21,9" />
                <polyline points="3,15 3,21 9,21" /><polyline points="21,15 21,21 15,21" />
              </svg>
            )}
          </IconBtn>
          {/* Pantalla completa nativa (F11 del elemento) */}
          <IconBtn light={lightPanel} onClick={toggleFullscreen} title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}>
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
        </>
      )}
      <IconBtn light={lightPanel} onClick={closePanel} title="Cerrar visor">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </IconBtn>
    </div>
  );

  const panelShell = (isOverlay: boolean) => (
    <PanelThemeCtx.Provider value={lightPanel ? "light" : "dark"}>
      <div className={isOverlay || isSubFullscreen ? "flex flex-col h-full rounded-none overflow-hidden shadow-2xl" : "flex flex-col h-full rounded-2xl overflow-hidden shadow-2xl"}>
        {panelHeader(isOverlay)}
        <PanelContent
          key={active?.fileUrl}
          entry={active as PanelEntry}
          onAspectRatio={setAspectRatio}
          xlsxMode={xlsxMode}
          initialScale={isMobileView ? 0.75 : 1.0}
          fileCache={fileCache}
        />
      </div>
    </PanelThemeCtx.Provider>
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
                ? { overflow: "hidden", padding: 0, pointerEvents: "none", opacity: 0, height: 0 }
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

          {/* Preview de archivo — siempre a la derecha (order 3).
              Cuando isSubFullscreen el inner div adopta fixed inset-0 para cubrir
              toda la ventana sin desmontar PanelContent (no hay flash de PDF). */}
          {!isMobileView && fileOpen && (
            <div
              style={{
                order: 3,
                // Colapsar el ítem flex cuando está en sub-fullscreen: el contenido
                // escapa al viewport via position:fixed y no ocupa espacio en el layout.
                flex: isSubFullscreen ? "0 0 0px" : splitTaskFile ? 1 : rightFlexFile,
                minWidth: 0,
                overflow: "hidden",
                transition: "flex 0.38s cubic-bezier(0.4,0,0.2,1)",
              }}
            >
              <div
                ref={panelRef}
                className={isSubFullscreen ? "fixed inset-0 z-[200]" : "lg:sticky"}
                style={isSubFullscreen ? {} : { top: panelTop, height: `calc(100vh - ${panelTop + 8}px)` }}
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
