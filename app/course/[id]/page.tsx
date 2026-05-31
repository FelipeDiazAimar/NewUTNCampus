"use client";

import { use, useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useCourseContents } from "@/lib/hooks";
import type { MoodleModule, MoodleContent } from "@/lib/moodle";
import type { ConvertResult, Slide } from "@/app/api/convert/route";
import type { AssignInfo } from "@/app/api/assign/route";

function getUserInfo() {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/moodle_user=([^;]+)/);
  if (!m) return {};
  try { return JSON.parse(decodeURIComponent(m[1])); } catch { return {}; }
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const MOD_COLORS: Record<string, [string, string]> = {
  resource: ["#007aff", "#e8f4fd"],
  folder:   ["#ff9500", "#fff3e0"],
  assign:   ["#34c759", "#e8f8ed"],
  forum:    ["#5ac8fa", "#e0f7ff"],
  quiz:     ["#af52de", "#f3e8ff"],
  url:      ["#ff2d55", "#ffe8ed"],
  page:     ["#8e8e93", "#f2f2f7"],
};

const MOD_LABELS: Record<string, string> = {
  resource:        "ARCH",
  folder:          "CARP",
  assign:          "Tarea",
  forum:           "Foro",
  quiz:            "Quiz",
  url:             "URL",
  page:            "Pág",
  workshop:        "Tall",
  wiki:            "Wiki",
  glossary:        "Glos",
  choice:          "Enc",
  survey:          "Enc",
  scorm:           "SCORM",
  h5pactivity:     "H5P",
  collaborate:     "Cola",
  bigbluebuttonbn: "BBB",
  videotime:       "Video",
  hvp:             "H5P",
  lti:             "LTI",
};

function getModBadge(mod: MoodleModule): string {
  const content = mod.contents?.[0];
  // 1. Prefer fileType extracted from Moodle icon (always accurate)
  if (content?.fileType) return content.fileType.slice(0, 4);
  // 2. Use filename extension only if it looks like a real one (2-5 alphanum chars)
  if (content?.filename) {
    const parts = content.filename.split(".");
    if (parts.length > 1) {
      const ext = parts.pop()?.toUpperCase() ?? "";
      if (/^[A-Z0-9]{2,5}$/.test(ext)) return ext.slice(0, 4);
    }
  }
  return MOD_LABELS[mod.modname] ?? mod.modname.slice(0, 4).toUpperCase();
}

function formatBytes(b: number) {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

// ─── File-kind detection ──────────────────────────────────────────────────────

type ViewerKind =
  | "pdf" | "image" | "video" | "audio"
  | "docx" | "xlsx" | "pptx" | "text"
  | "none";

function kindFromExt(name: string): ViewerKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["jpg","jpeg","png","gif","webp","svg","bmp","avif"].includes(ext)) return "image";
  if (["mp4","webm","mov","ogv","avi"].includes(ext)) return "video";
  if (["mp3","wav","ogg","aac","m4a","flac"].includes(ext)) return "audio";
  if (ext === "docx") return "docx";
  if (["xlsx","xls","csv"].includes(ext)) return "xlsx";
  if (ext === "pptx") return "pptx";
  if (["txt","html","htm","md","xml","json"].includes(ext)) return "text";
  return "none";
}

function kindFromCT(ct: string): ViewerKind {
  if (!ct) return "none";
  if (ct.includes("pdf")) return "pdf";
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  if (ct.includes("wordprocessingml") || ct.includes("msword")) return "docx";
  if (ct.includes("spreadsheetml") || ct.includes("ms-excel")) return "xlsx";
  if (ct.includes("presentationml") || ct.includes("mspowerpoint")) return "pptx";
  if (ct.startsWith("text/")) return "text";
  return "none";
}

// Only PPTX and text are still server-converted; DOCX and XLSX are rendered client-side
const OFFICE_KINDS: ViewerKind[] = ["pptx", "text"];

// ─── Viewer states ────────────────────────────────────────────────────────────

type State =
  | { phase: "idle" }
  | { phase: "loading"; label: string }
  | { phase: "error"; message: string }
  | { phase: "pdf" }
  | { phase: "image" }
  | { phase: "video" }
  | { phase: "audio" }
  | { phase: "docx"; buffer: ArrayBuffer }
  | { phase: "xlsx"; buffer: ArrayBuffer }
  | { phase: "office"; data: ConvertResult }
  | { phase: "none" };

// ─── Sub-viewers ─────────────────────────────────────────────────────────────

// DOCX — renders natively via docx-preview (proper fonts, tables, images)
function DocxViewer({ buffer }: { buffer: ArrayBuffer }) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"rendering" | "done" | "error">("rendering");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!ref.current) return;
    import("docx-preview")
      .then(({ renderAsync }) =>
        renderAsync(buffer, ref.current!, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          useBase64URL: true,
          breakPages: true,
        })
      )
      .then(() => setStatus("done"))
      .catch((e) => { setStatus("error"); setErrMsg((e as Error).message); });
  }, [buffer]);

  return (
    <div className="overflow-auto" style={{ maxHeight: "75vh", background: "#525659" }}>
      {status === "rendering" && (
        <div className="flex items-center justify-center gap-2 h-20 bg-white">
          <div className="w-4 h-4 border-2 border-[#007aff] border-t-transparent rounded-full animate-spin" />
          <span className="text-[13px] text-[#6c6c70]">Renderizando documento…</span>
        </div>
      )}
      {status === "error" && (
        <p className="text-[#ff3b30] text-sm p-4">Error al renderizar: {errMsg}</p>
      )}
      <div ref={ref} className={status === "rendering" ? "hidden" : ""} />
    </div>
  );
}

// XLSX / CSV — parses client-side with SheetJS, renders with Excel-style grid
function XlsxViewer({ buffer }: { buffer: ArrayBuffer }) {
  type CellData = { v: string; right: boolean };
  type SheetParsed = { name: string; cols: string[]; rows: { num: number; cells: CellData[] }[] };

  const [sheets, setSheets] = useState<SheetParsed[]>([]);
  const [active, setActive] = useState(0);
  const [err, setErr] = useState("");

  useEffect(() => {
    import("xlsx").then((XLSX) => {
      const wb = XLSX.read(buffer, { type: "array" });
      const parsed: SheetParsed[] = wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name];
        const ref = ws["!ref"];
        if (!ref) return { name, cols: [], rows: [] };
        const range = XLSX.utils.decode_range(ref);

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

  if (err) return <p className="text-[#ff3b30] text-sm p-4">{err}</p>;
  if (sheets.length === 0) return (
    <div className="flex items-center justify-center gap-2 h-20">
      <div className="w-4 h-4 border-2 border-[#007aff] border-t-transparent rounded-full animate-spin" />
      <span className="text-[13px] text-[#6c6c70]">Procesando hoja de cálculo…</span>
    </div>
  );

  const sheet = sheets[active];
  const BORDER = "1px solid #c8c8c8";
  const HDR = "#f0f0f0";

  return (
    <div className="flex flex-col" style={{ maxHeight: "75vh" }}>
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex gap-0 border-b border-[#c8c8c8] bg-[#f0f0f0] px-2 pt-1.5 overflow-x-auto">
          {sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              style={{
                padding: "4px 14px", fontSize: "12px", fontWeight: i === active ? 600 : 400,
                borderTop: i === active ? "2px solid #007aff" : "2px solid transparent",
                borderLeft: BORDER, borderRight: BORDER,
                borderBottom: i === active ? "1px solid white" : BORDER,
                background: i === active ? "white" : "#e8e8e8",
                color: i === active ? "#007aff" : "#555",
                marginBottom: i === active ? "-1px" : 0,
                whiteSpace: "nowrap", cursor: "pointer",
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Spreadsheet grid */}
      <div className="overflow-auto flex-1" style={{ background: "#fff" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "12px", fontFamily: "system-ui,sans-serif", tableLayout: "auto" }}>
          <thead>
            <tr>
              {/* Corner cell */}
              <th style={{ position: "sticky", top: 0, left: 0, zIndex: 4, background: HDR, border: BORDER, minWidth: 46, width: 46 }} />
              {sheet.cols.map((col) => (
                <th key={col} style={{
                  position: "sticky", top: 0, zIndex: 3,
                  background: HDR, border: BORDER,
                  padding: "3px 6px", minWidth: 72,
                  fontWeight: 600, textAlign: "center",
                  fontSize: 11, color: "#444",
                  userSelect: "none",
                }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map(({ num, cells }) => (
              <tr key={num} style={{ height: 20 }}>
                {/* Row number */}
                <td style={{
                  position: "sticky", left: 0, zIndex: 2,
                  background: HDR, border: BORDER,
                  padding: "2px 8px 2px 4px", textAlign: "right",
                  fontWeight: 600, fontSize: 11, color: "#444",
                  minWidth: 46, userSelect: "none",
                }}>
                  {num}
                </td>
                {/* Data cells */}
                {cells.map((cell, ci) => (
                  <td key={ci} style={{
                    border: BORDER,
                    padding: "2px 6px",
                    whiteSpace: "nowrap",
                    textAlign: cell.right ? "right" : "left",
                    background: "white",
                    maxWidth: 240,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {cell.v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SlideViewer — presentation-style 16:9 canvas ─────────────────────────────

function SlideViewer({ slides }: { slides: Slide[] }) {
  const [idx, setIdx] = useState(0);

  if (slides.length === 0) {
    return <p className="text-[#8e8e93] text-sm text-center py-8">Sin contenido en la presentación.</p>;
  }

  const slide = slides[idx];

  return (
    <div style={{ background: "#0d0f14" }}>
      {/* 16:9 slide canvas */}
      <div style={{ aspectRatio: "16/9", position: "relative", background: "linear-gradient(140deg, #0f1923 0%, #1a2332 100%)", overflow: "hidden" }}>
        {/* Accent bar */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: "linear-gradient(90deg, #007aff, #5ac8fa)" }} />

        {/* Content */}
        <div style={{ position: "absolute", inset: "16px 36px 28px 24px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "8px", overflow: "hidden" }}>
          {slide.paragraphs.length === 0 ? (
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "13px", textAlign: "center" }}>Diapositiva sin texto.</p>
          ) : (
            <>
              <h2 style={{ color: "#ffffff", fontSize: "clamp(13px, 3.2vw, 22px)", fontWeight: "700", lineHeight: "1.2", letterSpacing: "-0.2px", margin: 0, textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}>
                {slide.paragraphs[0]}
              </h2>

              {slide.paragraphs.length > 1 && (
                <div style={{ width: "32px", height: "2px", background: "#007aff", borderRadius: "1px", flexShrink: 0 }} />
              )}

              {slide.paragraphs.slice(1).map((p, i) => (
                <div key={i} style={{ display: "flex", gap: "7px", alignItems: "flex-start" }}>
                  <span style={{ color: "#5ac8fa", fontSize: "clamp(9px, 1.7vw, 12px)", marginTop: "1px", flexShrink: 0, lineHeight: "1.45" }}>•</span>
                  <p style={{ color: "rgba(210,230,255,0.82)", fontSize: "clamp(9px, 1.7vw, 12px)", lineHeight: "1.45", margin: 0 }}>{p}</p>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Slide number */}
        <div style={{ position: "absolute", bottom: "8px", right: "12px", color: "rgba(255,255,255,0.22)", fontSize: "9px", fontWeight: "500", fontVariantNumeric: "tabular-nums" }}>
          {idx + 1} / {slides.length}
        </div>

        {/* Prev */}
        {idx > 0 && (
          <button
            onClick={() => setIdx((i) => i - 1)}
            style={{ position: "absolute", left: "6px", top: "50%", transform: "translateY(-50%)", width: "26px", height: "26px", borderRadius: "50%", background: "rgba(255,255,255,0.13)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><polyline points="15,18 9,12 15,6" /></svg>
          </button>
        )}

        {/* Next */}
        {idx < slides.length - 1 && (
          <button
            onClick={() => setIdx((i) => i + 1)}
            style={{ position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)", width: "26px", height: "26px", borderRadius: "50%", background: "rgba(255,255,255,0.13)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><polyline points="9,18 15,12 9,6" /></svg>
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      {slides.length > 1 && (
        <div style={{ display: "flex", gap: "6px", padding: "8px 10px", overflowX: "auto", background: "#161b22", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {slides.map((s, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              style={{ flexShrink: 0, width: "64px", height: "40px", borderRadius: "4px", border: `2px solid ${i === idx ? "#007aff" : "rgba(255,255,255,0.08)"}`, background: "linear-gradient(140deg, #0f1923, #1a2332)", padding: "4px 5px", cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "flex-start", transition: "border-color 0.15s", position: "relative", overflow: "hidden" }}
            >
              <div style={{ width: "100%", height: "2px", background: "linear-gradient(90deg,#007aff,#5ac8fa)", marginBottom: "3px" }} />
              <span style={{ color: i === idx ? "#60b3ff" : "rgba(255,255,255,0.4)", fontSize: "5px", fontWeight: "700", lineHeight: "1.3", textAlign: "left", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as React.CSSProperties}>
                {s.paragraphs[0] ?? `Slide ${s.index}`}
              </span>
              <span style={{ position: "absolute", bottom: "2px", right: "3px", color: "rgba(255,255,255,0.18)", fontSize: "4.5px" }}>{i + 1}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TextViewer({ text }: { text: string }) {
  const isHtml = /<[a-z][\s\S]*>/i.test(text.slice(0, 500));
  if (isHtml) {
    return <iframe srcDoc={text} title="Vista HTML" sandbox="allow-same-origin" className="w-full border-0" style={{ height: "70vh" }} />;
  }
  return (
    <pre className="p-4 text-[13px] text-[#1c1c1e] leading-relaxed overflow-auto whitespace-pre-wrap break-words" style={{ maxHeight: "70vh", fontFamily: "'SF Mono','Menlo',monospace" }}>
      {text}
    </pre>
  );
}

// ─── FileViewer ───────────────────────────────────────────────────────────────

function FileViewer({ content }: { content: MoodleContent }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ phase: "idle" });

  const proxyUrl = `/api/files?url=${encodeURIComponent(content.fileurl!)}&inline=1`;
  const downloadUrl = `/api/files?url=${encodeURIComponent(content.fileurl!)}`;
  const quickKind = kindFromExt(content.filename);

  const load = useCallback(async () => {
    if (state.phase !== "idle") return;

    let kind = quickKind;
    if (kind === "none") {
      setState({ phase: "loading", label: "Detectando tipo…" });
      try {
        const r = await fetch(`/api/meta?url=${encodeURIComponent(content.fileurl!)}`);
        const j = await r.json();
        kind = kindFromCT(j.contentType) !== "none" ? kindFromCT(j.contentType) : kindFromExt(j.filename ?? "");
      } catch { /* remain none */ }
    }

    // DOCX — client-side via docx-preview
    if (kind === "docx") {
      setState({ phase: "loading", label: "Descargando documento…" });
      try {
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setState({ phase: "docx", buffer: await res.arrayBuffer() });
      } catch (e) { setState({ phase: "error", message: (e as Error).message }); }
      return;
    }

    // XLSX / CSV — client-side via SheetJS
    if (kind === "xlsx") {
      setState({ phase: "loading", label: "Descargando hoja de cálculo…" });
      try {
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setState({ phase: "xlsx", buffer: await res.arrayBuffer() });
      } catch (e) { setState({ phase: "error", message: (e as Error).message }); }
      return;
    }

    // PPTX / text — server-side conversion
    if (OFFICE_KINDS.includes(kind)) {
      setState({ phase: "loading", label: "Convirtiendo documento…" });
      try {
        const r = await fetch(`/api/convert?url=${encodeURIComponent(content.fileurl!)}&filename=${encodeURIComponent(content.filename)}`);
        if (!r.ok) throw new Error(await r.text());
        const data: ConvertResult = await r.json();
        setState({ phase: "office", data });
      } catch (e) {
        setState({ phase: "error", message: (e as Error).message });
      }
      return;
    }

    if (kind === "pdf") { setState({ phase: "pdf" }); return; }
    if (kind === "image") { setState({ phase: "image" }); return; }
    if (kind === "video") { setState({ phase: "video" }); return; }
    if (kind === "audio") { setState({ phase: "audio" }); return; }
    setState({ phase: "none" });
  }, [state.phase, quickKind, content.fileurl, content.filename, proxyUrl]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) load();
  }

  const ext = content.filename.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE";

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-[#f2f2f7] transition-colors">
        <button onClick={toggle} className="w-8 h-8 rounded-lg bg-[#e8f4fd] flex items-center justify-center shrink-0 active:opacity-70">
          <span style={{ fontSize: ext.length > 3 ? "8px" : "9px" }} className="font-bold text-[#007aff] leading-none">{ext}</span>
        </button>

        <button onClick={toggle} className="flex-1 min-w-0 text-left active:opacity-70">
          <p className="text-[14px] text-[#1c1c1e] truncate">{content.filename}</p>
          {content.filesize > 0 && <p className="text-[12px] text-[#8e8e93]">{formatBytes(content.filesize)}</p>}
        </button>

        <div className="flex items-center gap-3 shrink-0">
          <button onClick={toggle} title={open ? "Cerrar" : "Ver"} className="text-[#007aff] hover:opacity-70 transition-opacity">
            {open ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
          <a href={downloadUrl} title="Descargar" onClick={(e) => e.stopPropagation()} className="text-[#8e8e93] hover:text-[#007aff] transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>
        </div>
      </div>

      {open && (
        <div className="border-t border-[rgba(60,60,67,0.06)] bg-[#f9f9f9]">
          {(state.phase === "loading" || state.phase === "idle") && (
            <div className="flex items-center justify-center gap-2 h-20">
              <div className="w-4 h-4 border-2 border-[#007aff] border-t-transparent rounded-full animate-spin" />
              <span className="text-[13px] text-[#6c6c70]">{state.phase === "loading" ? state.label : "Cargando…"}</span>
            </div>
          )}
          {state.phase === "error" && (
            <p className="text-sm text-[#8e8e93] text-center py-5">
              Error al cargar.{" "}<a href={downloadUrl} className="text-[#007aff]">Descargar</a>
            </p>
          )}
          {state.phase === "none" && (
            <div className="py-6 text-center px-4">
              <p className="text-sm text-[#8e8e93] mb-3">No se puede previsualizar este formato.</p>
              <a href={downloadUrl} className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#007aff] text-white rounded-2xl text-sm font-semibold">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7,10 12,15 17,10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Descargar
              </a>
            </div>
          )}
          {state.phase === "image" && <div className="p-3"><img src={proxyUrl} alt={content.filename} className="max-w-full mx-auto rounded-xl shadow-sm" loading="lazy" /></div>}
          {state.phase === "video" && <div className="p-3"><video src={proxyUrl} controls className="w-full rounded-xl max-h-[70vh]" /></div>}
          {state.phase === "audio" && <div className="p-4"><audio src={proxyUrl} controls className="w-full" /></div>}
          {state.phase === "pdf" && <iframe src={proxyUrl} title={content.filename} className="w-full border-0" style={{ height: "75vh" }} />}
          {state.phase === "docx" && <DocxViewer buffer={state.buffer} />}
          {state.phase === "xlsx" && <XlsxViewer buffer={state.buffer} />}
          {state.phase === "office" && state.data.kind === "slides" && <SlideViewer slides={state.data.slides} />}
          {state.phase === "office" && state.data.kind === "text" && <TextViewer text={state.data.text} />}
        </div>
      )}
    </div>
  );
}

// ─── UrlModuleRow — resolves external URL on tap ──────────────────────────────

function UrlModuleRow({ mod }: { mod: MoodleModule }) {
  const [resolving, setResolving] = useState(false);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);

  async function handleOpen() {
    if (externalUrl) { window.open(externalUrl, "_blank", "noopener,noreferrer"); return; }
    if (!mod.url) return;
    setResolving(true);
    try {
      const r = await fetch(`/api/resolve?url=${encodeURIComponent(mod.url)}`);
      const { url } = await r.json();
      setExternalUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      window.open(mod.url, "_blank", "noopener,noreferrer");
    } finally {
      setResolving(false);
    }
  }

  return (
    <button
      onClick={handleOpen}
      disabled={resolving}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#f2f2f7] active:bg-[#e5e5ea] transition-colors text-left"
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#ffe8ed", color: "#ff2d55" }}>
        {resolving ? (
          <div className="w-3.5 h-3.5 border-2 border-[#ff2d55] border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] text-[#1c1c1e] truncate">{mod.name}</p>
        {externalUrl && <p className="text-[11px] text-[#8e8e93] truncate">{externalUrl}</p>}
      </div>
      <svg className="w-4 h-4 text-[#c7c7cc] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
    </button>
  );
}

// ─── AssignModuleRow — shows assignment details inline ─────────────────────────

function AssignModuleRow({ mod }: { mod: MoodleModule }) {
  const [open, setOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [info, setInfo] = useState<AssignInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function toggle() {
    if (!open && !info && mod.url) {
      setFetching(true);
      setErr(null);
      fetch(`/api/assign?url=${encodeURIComponent(mod.url)}`)
        .then((r) => r.json())
        .then((d) => { if (d.error) throw new Error(d.error); setInfo(d); })
        .catch((e) => setErr((e as Error).message))
        .finally(() => setFetching(false));
    }
    setOpen((o) => !o);
  }

  const submissionRow = info?.rows.find((r) => /estado de entrega/i.test(r.label));
  const gradeRow      = info?.rows.find((r) => /calificaci/i.test(r.label));
  const timeRow       = info?.rows.find((r) => /tiempo restante/i.test(r.label));
  const otherRows     = info?.rows.filter((r) => r !== submissionRow && r !== gradeRow && r !== timeRow) ?? [];

  const submissionVal = submissionRow?.value ?? "";
  const isSubmitted = /entregado/i.test(submissionVal);
  const isOverdue   = /venc/i.test(submissionVal) || /venc/i.test(timeRow?.value ?? "");
  const statusColor = isSubmitted ? "#34c759" : isOverdue ? "#ff9500" : "#ff3b30";
  const statusBg    = isSubmitted ? "#e8f8ed"  : isOverdue ? "#fff3e0" : "#fff2f2";

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#f2f2f7] active:bg-[#e5e5ea] transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-bold" style={{ background: "#e8f8ed", color: "#34c759", fontSize: "7px" }}>
          Tarea
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] text-[#1c1c1e] truncate">{mod.name}</p>
        </div>
        <svg className={`w-4 h-4 text-[#c7c7cc] shrink-0 transition-transform ${open ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[rgba(60,60,67,0.08)]" style={{ background: "#fafafa" }}>
          {fetching && (
            <div className="flex items-center justify-center gap-2 h-20">
              <div className="w-4 h-4 border-2 border-[#34c759] border-t-transparent rounded-full animate-spin" />
              <span className="text-[13px] text-[#6c6c70]">Cargando tarea…</span>
            </div>
          )}
          {err && <p className="text-sm text-[#ff3b30] px-4 py-4">{err}</p>}
          {info && !fetching && (
            <div className="px-4 py-4 space-y-3">
              {/* Dates */}
              {info.dates.length > 0 && (
                <div className="bg-white rounded-xl px-3 py-3 shadow-sm space-y-2.5">
                  {info.dates.map((d, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <p className="text-[11px] font-semibold text-[#8e8e93] uppercase tracking-wide w-16 shrink-0 pt-0.5">{d.label}</p>
                      <p className="text-[13px] text-[#1c1c1e] font-medium">{d.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Submission status */}
              {submissionVal && (
                <div className="rounded-xl px-3 py-2.5" style={{ background: statusBg }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: statusColor }}>
                    Estado de entrega
                  </p>
                  <p className="text-[14px] font-semibold text-[#1c1c1e]">{submissionVal}</p>
                </div>
              )}

              {/* Time remaining */}
              {timeRow && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[12px] text-[#8e8e93]">{timeRow.label}:</span>
                  <span className="text-[12px] font-medium" style={{ color: isOverdue ? "#ff9500" : "#1c1c1e" }}>
                    {timeRow.value}
                  </span>
                </div>
              )}

              {/* Grade */}
              {gradeRow && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[12px] text-[#8e8e93]">{gradeRow.label}:</span>
                  <span className="text-[12px] font-medium text-[#1c1c1e]">{gradeRow.value}</span>
                </div>
              )}

              {/* Other status rows */}
              {otherRows.map((r, i) => (
                <div key={i} className="flex items-start gap-2 px-1">
                  <span className="text-[12px] text-[#8e8e93] shrink-0">{r.label}:</span>
                  <span className="text-[12px] text-[#1c1c1e]">{r.value}</span>
                </div>
              ))}

              {/* Description */}
              {info.description && (
                <div className="bg-white rounded-xl px-3 py-3 shadow-sm">
                  <p className="text-[12px] text-[#6c6c70] leading-relaxed">{info.description}</p>
                </div>
              )}

              {/* Open in campus */}
              {mod.url && (
                <a
                  href={mod.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-2xl text-[14px] font-semibold text-white"
                  style={{ background: "#34c759" }}
                >
                  Ver en Campus
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ModuleRow ────────────────────────────────────────────────────────────────

function ModuleRow({ mod }: { mod: MoodleModule }) {
  const [open, setOpen] = useState(false);

  if (mod.modname === "label") {
    return <div className="px-4 py-2 text-[13px] text-[#6c6c70] italic" dangerouslySetInnerHTML={{ __html: mod.name }} />;
  }

  // Assignment → show details inline
  if (mod.modname === "assign") {
    return <AssignModuleRow mod={mod} />;
  }

  // URL-type content → resolve external URL and open in new tab
  if (mod.contents?.[0]?.type === "url") {
    return <UrlModuleRow mod={mod} />;
  }

  const [color, bg] = MOD_COLORS[mod.modname] ?? ["#8e8e93", "#f2f2f7"];
  const hasFiles = (mod.contents?.length ?? 0) > 0;
  const isPreviewable = hasFiles && (mod.modname === "resource" || mod.modname === "folder");
  const badge = getModBadge(mod);
  const badgeFontSize = badge.length >= 5 ? "7px" : badge.length === 4 ? "9px" : "11px";

  return (
    <div>
      <button
        onClick={() => {
          if (isPreviewable) setOpen((o) => !o);
          else if (mod.url) window.open(mod.url, "_blank", "noopener,noreferrer");
        }}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#f2f2f7] active:bg-[#e5e5ea] transition-colors text-left"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-bold"
          style={{ background: bg, color, fontSize: badgeFontSize }}
        >
          {badge}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] text-[#1c1c1e] truncate">{mod.name}</p>
        </div>
        {(isPreviewable || mod.url) && (
          <svg
            className={`w-4 h-4 text-[#c7c7cc] shrink-0 transition-transform ${isPreviewable && open ? "rotate-90" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          >
            <polyline points="9,18 15,12 9,6" />
          </svg>
        )}
      </button>

      {isPreviewable && open && (
        <div className="border-t border-[rgba(60,60,67,0.08)] bg-[#fafafa] divide-y divide-[rgba(60,60,67,0.06)]">
          {mod.contents!.map((c, i) => <FileViewer key={i} content={c} />)}
        </div>
      )}
    </div>
  );
}

// ─── SectionAccordion ─────────────────────────────────────────────────────────

function SectionAccordion({ section, defaultOpen }: { section: { id: number; name: string; modules: MoodleModule[] }; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const visibleMods = section.modules.filter((m) => m.visible !== 0 && m.modname !== "label");

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-4 text-left hover:bg-[#f9f9f9] transition-colors">
        <div>
          <p className="text-[16px] font-semibold text-[#1c1c1e]">{section.name || "General"}</p>
          <p className="text-[12px] text-[#8e8e93] mt-0.5">{visibleMods.length} elemento{visibleMods.length !== 1 ? "s" : ""}</p>
        </div>
        <svg className={`w-5 h-5 text-[#c7c7cc] transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <polyline points="6,9 12,15 18,9" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-[rgba(60,60,67,0.1)] divide-y divide-[rgba(60,60,67,0.06)]">
          {section.modules.filter((m) => m.visible !== 0).map((mod) => <ModuleRow key={mod.id} mod={mod} />)}
        </div>
      )}
    </div>
  );
}

// ─── CoursePage ───────────────────────────────────────────────────────────────

export default function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { sections, courseName, loading, error } = useCourseContents(parseInt(id));
  const [userInfo, setUserInfo] = useState<{ fullname?: string }>({});

  useEffect(() => {
    setUserInfo(getUserInfo());
    if (!document.cookie.includes("moodle_user")) router.push("/");
  }, [router]);

  const visible = sections.filter((s) => s.visible !== 0 && s.modules.length > 0);

  return (
    <div className="min-h-screen bg-[#f2f2f7]">
      <Navbar fullname={userInfo.fullname} />
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Back link */}
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-[15px] text-[#007aff] font-medium mb-5 hover:opacity-70 transition-opacity">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
          Materias
        </Link>

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
                <p style={{ fontSize: "11px", fontWeight: "700", color: "#007aff", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: "4px" }}>
                  Materia
                </p>
                <h1 style={{ fontSize: "clamp(22px, 5vw, 30px)", fontWeight: "800", color: "#1c1c1e", lineHeight: "1.1", letterSpacing: "-0.5px", margin: 0 }}>
                  {courseName}
                </h1>
                {!loading && (
                  <p style={{ fontSize: "13px", color: "#8e8e93", marginTop: "6px" }}>
                    {visible.length} sección{visible.length !== 1 ? "es" : ""}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-2xl h-20 animate-pulse shadow-sm" />)}
          </div>
        )}
        {error && <div className="bg-[#fff2f2] border border-[#ffcdd2] rounded-2xl p-5 text-[#ff3b30] text-sm">{error}</div>}
        {!loading && !error && (
          <div className="space-y-3">
            {visible.map((s, i) => <SectionAccordion key={s.id} section={s} defaultOpen={i === 0} />)}
            {visible.length === 0 && <p className="text-center py-16 text-[#6c6c70] text-[15px]">Sin contenido visible todavía.</p>}
          </div>
        )}
      </main>
    </div>
  );
}
