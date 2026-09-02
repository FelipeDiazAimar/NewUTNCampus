"use client";

import { createContext, useContext, useState, useCallback, useEffect, type MouseEvent } from "react";
import { usePdfPreview, type PanelKind } from "@/components/CourseWorkspaceLayout";
import Spinner from "@/components/Spinner";
import type { MoodleContent } from "@/lib/moodle";
import { reportClientError } from "@/lib/clientErrorReporter";
import { getFile, saveFile, stableFileKey } from "@/lib/offlineFileCache";
import { downloadFile } from "@/lib/downloadFile";

// Identifica la materia actual para que FileViewer pueda agrupar los archivos
// guardados offline por materia sin que cada nivel intermedio del árbol
// (SectionAccordion → SectionModules → ModuleRow → FolderViewer) tenga que
// reenviar props que no le interesan.
export const MateriaContext = createContext<{ materiaId?: string; materiaNombre?: string }>({});

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

/**
 * Extracts the real filename from a Moodle fileurl.
 * e.g. "https://.../pluginfile.php/123/.../1-Redes-de-Datos-2026.pptx?forcedownload=1"
 * → "1-Redes-de-Datos-2026.pptx"
 * Falls back to display name + fileType if the URL is absent or unparseable.
 */
/**
 * Extracts the real filename from a Moodle fileurl.
 * e.g. ".../pluginfile.php/123/.../1-Redes-de-Datos-2026.pptx?token=1"
 * → "1-Redes-de-Datos-2026.pptx"
 * Falls back to displayName + fileType when the URL is a view.php redirect
 * or has no recognizable filename in the path.
 */
export function realFilename(fileurl: string | undefined, displayName: string, fileType?: string): string {
  if (fileurl) {
    try {
      const pathname = new URL(fileurl).pathname;
      const last = decodeURIComponent(pathname.split("/").pop() ?? "");
      // Only use it if it looks like a real filename (has a short extension, not a PHP script)
      if (last && /\.[a-zA-Z0-9]{1,5}$/.test(last) && !last.endsWith(".php")) return last;
    } catch { /* fall through */ }
  }
  // Fallback: display name + extension
  const dot = displayName.lastIndexOf(".");
  if (dot > 0 && displayName.length - dot <= 6 && !displayName.endsWith(".php")) return displayName;
  const ext = fileType?.toLowerCase();
  return ext ? `${displayName}.${ext}` : displayName;
}

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
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const { openPanel, closePanel, activeKey } = usePdfPreview();
  const { materiaId, materiaNombre } = useContext(MateriaContext);

  const fileName    = resolvedName ?? realFilename(content.fileurl, content.filename, content.fileType);
  // Clave estable para IndexedDB — content.fileurl es un token cifrado que
  // cambia en cada respuesta del servidor aunque sea el mismo archivo real,
  // así que no sirve para identificar un archivo guardado entre visitas. Se
  // manda también en la URL para que el Service Worker (que no puede
  // desencriptar el ref) sepa qué buscar en IndexedDB si falla la red.
  const offlineKey = materiaId
    ? stableFileKey(materiaId, fileName, content.timemodified)
    : content.fileurl!;
  const proxyUrl    = `/api/files?ref=${encodeURIComponent(content.fileurl!)}&inline=1&offlineKey=${encodeURIComponent(offlineKey)}`;
  const downloadUrl = `/api/files?ref=${encodeURIComponent(content.fileurl!)}&offlineKey=${encodeURIComponent(offlineKey)}`;
  const isActive    = activeKey === content.fileurl;

  // view.php filenames are already resolved server-side in /api/course.
  // This effect is a client-side fallback for any that slipped through
  // (e.g. mock data or cached responses with unresolved names).
  useEffect(() => {
    if (!content.fileurl?.includes("view.php")) return;
    // If the server already resolved it, filename won't look like a display name
    // (it will have an extension). Skip the fetch if that's the case.
    const dot = content.filename.lastIndexOf(".");
    if (dot > 0 && content.filename.length - dot <= 6) return;
    fetch(`/api/meta?ref=${encodeURIComponent(content.fileurl)}`)
      .then((r) => r.json())
      .then((j) => { if (j.filename) setResolvedName(j.filename); })
      .catch(() => { /* ignore — display name is the fallback */ });
  }, [content.fileurl, content.filename]);

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
        const r = await fetch(`/api/meta?ref=${encodeURIComponent(content.fileurl!)}`);
        const j = await r.json();
        kind = kindFromCT(j.contentType) !== "none"
          ? kindFromCT(j.contentType)
          : kindFromExt(j.filename ?? "");
      } catch (e) {
        reportClientError("warning", `Detección de tipo de archivo (${fileName}): ${(e as Error).message}`);
      }
    }

    // Guardado offline en background — no bloquea la apertura del archivo.
    if (materiaId && (await filesEnabled())) {
      fetch(proxyUrl)
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (!blob) return;
          saveFile(offlineKey, blob, {
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
      openPanel({
        kind: kind as PanelKind,
        proxyUrl,
        fileUrl: content.fileurl!,
        name: fileName,
      });
      setState({ phase: "panel" });
      return;
    }

    // Media → show inline
    if (kind === "image") { setState({ phase: "image" }); return; }
    if (kind === "video") { setState({ phase: "video" }); return; }
    if (kind === "audio") { setState({ phase: "audio" }); return; }
    setState({ phase: "none" });
  }, [isActive, content.fileType, content.filename, content.fileurl, proxyUrl, openPanel, closePanel, fileName, materiaId, materiaNombre, offlineKey]);

  // Cuando otro archivo toma el panel, limpiar el indicador local.
  useEffect(() => {
    if (!isActive && state.phase === "panel") setState({ phase: "idle" });
  }, [isActive, state.phase]);

  const [downloading, setDownloading] = useState(false);

  // Descarga directa. Usa el helper compartido, que en la PWA instalada evita
  // que el WebView navegue al recurso y abra el visor nativo del teléfono.
  const handleDownload = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadFile(downloadUrl, fileName, { offlineKey });
    } catch (err) {
      reportClientError("warning", `Descarga (${fileName}): ${(err as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }, [downloading, downloadUrl, fileName, offlineKey]);

  // "Guardar como…" — deja elegir carpeta de destino (igual que el botón del visor).
  // Cae a la descarga normal si el navegador no soporta la File System Access API.
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
        const offline = await getFile(offlineKey);
        if (!offline) throw networkErr;
        blob = offline.blob;
      }
      const wr = await handle.createWritable();
      await wr.write(blob);
      await wr.close();
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      // "not supported" es esperado (Firefox/Safari no tienen showSaveFilePicker) —
      // solo lo real vale la pena reportar.
      if ((err as Error).message !== "not supported") {
        reportClientError("warning", `Guardar archivo como (${fileName}): ${(err as Error).message}`);
      }
      await downloadFile(downloadUrl, fileName, { offlineKey });
    }
  }, [downloadUrl, fileName, offlineKey]);

  const isOpen = state.phase !== "idle" || isActive;

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] transition-colors">
        <button onClick={handleClick} className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0 active:opacity-70">
          <span style={{ fontSize: badge.length > 3 ? "8px" : "9px" }} className="font-bold text-[var(--accent)] leading-none">{badge}</span>
        </button>

        <button onClick={handleClick} className="flex-1 min-w-0 text-left active:opacity-70">
          <p className="text-[14px] text-[var(--fg)] break-words">{fileName}</p>
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
          <button onClick={handleDownload} disabled={downloading} title="Descargar" className="text-[var(--secondary)] hover:text-[var(--accent)] transition-colors disabled:opacity-50">
            {downloading ? (
              <Spinner size={16} color="currentColor" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7,10 12,15 17,10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            )}
          </button>
          {/* "Guardar como…" (elegir carpeta) sólo tiene sentido en escritorio;
              en móvil el navegador no soporta showSaveFilePicker y haría lo
              mismo que el botón de descarga directa. */}
          <button onClick={handleSaveAs} title="Guardar como…" className="hidden lg:block text-[var(--secondary)] hover:text-[var(--accent)] transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              <polyline points="12,11 12,17"/>
              <polyline points="9,14 12,17 15,14"/>
            </svg>
          </button>
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
              <button onClick={handleDownload} disabled={downloading} className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#007aff] text-white rounded-2xl text-sm font-semibold disabled:opacity-60">
                {downloading ? (
                  <Spinner size={16} color="#fff" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                )}
                {downloading ? "Descargando…" : "Descargar"}
              </button>
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
