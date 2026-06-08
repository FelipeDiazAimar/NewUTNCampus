"use client";

import { useState, useCallback } from "react";
import { usePdfPreview, type PanelKind } from "@/components/CourseWorkspaceLayout";
import Spinner from "@/components/Spinner";
import type { MoodleContent } from "@/lib/moodle";

export function formatBytes(b: number) {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

// ─── File-kind detection ──────────────────────────────────────────────────────

export type ViewerKind = PanelKind | "image" | "video" | "audio" | "none";

// Use the fileType field scraped from Moodle's icon URL — highest priority because
// content.filename is the module display name and often has no extension.
function kindFromFileType(ft?: string): ViewerKind {
  if (!ft) return "none";
  const m: Record<string, ViewerKind> = {
    PDF: "pdf", PPTX: "pptx", DOCX: "docx", XLSX: "xlsx",
    TXT: "text", IMG: "image", MP4: "video", MP3: "audio",
  };
  return m[ft.toUpperCase()] ?? "none";
}

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

const PANEL_KINDS: ViewerKind[] = ["pdf", "docx", "xlsx", "pptx", "text"];

// ─── Viewer states (media only — documents go to the panel) ──────────────────

type State =
  | { phase: "idle" }
  | { phase: "detecting" }
  | { phase: "panel" }   // document sent to right panel
  | { phase: "image" }
  | { phase: "video" }
  | { phase: "audio" }
  | { phase: "none" };

// ─── FileViewer ───────────────────────────────────────────────────────────────
// A single file row that previews PDF/DOCX/XLSX/PPTX/TXT in the workspace panel
// and images/video/audio inline. Used both for course resources and for files
// inside a folder (FolderViewer), so the preview behaviour is identical.

export function FileViewer({ content }: { content: MoodleContent }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const { openPanel, closePanel, activeKey } = usePdfPreview();

  const proxyUrl   = `/api/files?url=${encodeURIComponent(content.fileurl!)}&inline=1`;
  const downloadUrl = `/api/files?url=${encodeURIComponent(content.fileurl!)}`;
  const isActive   = activeKey === content.fileurl;

  const badge = content.fileType ?? (content.filename.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE");

  const handleClick = useCallback(async () => {
    // Toggle: close if already open in panel
    if (isActive) { closePanel(); setState({ phase: "idle" }); return; }

    // Detect kind — fileType from icon scrape is most reliable
    let kind: ViewerKind = kindFromFileType(content.fileType);
    if (kind === "none") kind = kindFromExt(content.filename);

    if (kind === "none") {
      setState({ phase: "detecting" });
      try {
        const r = await fetch(`/api/meta?url=${encodeURIComponent(content.fileurl!)}`);
        const j = await r.json();
        kind = kindFromCT(j.contentType) !== "none"
          ? kindFromCT(j.contentType)
          : kindFromExt(j.filename ?? "");
      } catch { /* remain none */ }
    }

    // Document kinds → open in right panel
    if (PANEL_KINDS.includes(kind)) {
      openPanel({
        kind: kind as PanelKind,
        proxyUrl,
        fileUrl: content.fileurl!,
        name: content.filename,
      });
      setState({ phase: "panel" });
      return;
    }

    // Media → show inline
    if (kind === "image") { setState({ phase: "image" }); return; }
    if (kind === "video") { setState({ phase: "video" }); return; }
    if (kind === "audio") { setState({ phase: "audio" }); return; }
    setState({ phase: "none" });
  }, [isActive, content.fileType, content.filename, content.fileurl, proxyUrl, openPanel, closePanel]);

  const isOpen = state.phase !== "idle" || isActive;

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] transition-colors">
        <button onClick={handleClick} className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0 active:opacity-70">
          <span style={{ fontSize: badge.length > 3 ? "8px" : "9px" }} className="font-bold text-[var(--accent)] leading-none">{badge}</span>
        </button>

        <button onClick={handleClick} className="flex-1 min-w-0 text-left active:opacity-70">
          <p className="text-[14px] text-[var(--fg)] truncate">{content.filename}</p>
          {content.filesize > 0 && <p className="text-[12px] text-[var(--secondary)]">{formatBytes(content.filesize)}</p>}
        </button>

        <div className="flex items-center gap-3 shrink-0">
          <button onClick={handleClick} title={isActive ? "Cerrar" : "Ver"} className="text-[var(--accent)] hover:opacity-70 transition-opacity">
            {isActive ? (
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
          <a href={downloadUrl} title="Descargar" onClick={(e) => e.stopPropagation()} className="text-[var(--secondary)] hover:text-[var(--accent)] transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>
        </div>
      </div>

      {/* Inline area — only for media and status indicators */}
      {isOpen && (
        <div className="border-t border-[rgba(60,60,67,0.06)] bg-[var(--surface2)]">
          {state.phase === "detecting" && (
            <div className="flex items-center justify-center gap-2.5 h-16">
              <Spinner size={18} color="#007aff" />
              <span className="text-[13px] text-[var(--secondary)]">Detectando tipo…</span>
            </div>
          )}
          {(state.phase === "panel" || isActive) && (
            <div className="flex items-center gap-2 px-4 py-3 bg-[var(--accent-light)]">
              <div className="w-2 h-2 rounded-full bg-[#007aff] shrink-0" />
              <span className="text-[13px] text-[var(--accent)] font-medium">Abierto en el visor →</span>
            </div>
          )}
          {state.phase === "none" && (
            <div className="py-5 text-center px-4">
              <p className="text-sm text-[var(--secondary)] mb-3">No se puede previsualizar este formato.</p>
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {state.phase === "image" && <div className="p-3"><img src={proxyUrl} alt={content.filename} className="max-w-full mx-auto rounded-xl shadow-sm" loading="lazy" /></div>}
          {state.phase === "video" && <div className="p-3"><video src={proxyUrl} controls className="w-full rounded-xl max-h-[70vh]" /></div>}
          {state.phase === "audio" && <div className="p-4"><audio src={proxyUrl} controls className="w-full" /></div>}
        </div>
      )}
    </div>
  );
}
