"use client";

import { use, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useCourseContents } from "@/lib/hooks";
import type { MoodleModule, MoodleContent } from "@/lib/moodle";
import type { AssignInfo } from "@/app/api/assign/route";
import WorkspaceLayout, { usePdfPreview, type PanelKind } from "@/components/CourseWorkspaceLayout";
import parse from "html-react-parser";
import Spinner, { SpinnerBlock } from "@/components/Spinner";

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

type ViewerKind = PanelKind | "image" | "video" | "audio" | "none";

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

function FileViewer({ content }: { content: MoodleContent }) {
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
          {state.phase === "image" && <div className="p-3"><img src={proxyUrl} alt={content.filename} className="max-w-full mx-auto rounded-xl shadow-sm" loading="lazy" /></div>}
          {state.phase === "video" && <div className="p-3"><video src={proxyUrl} controls className="w-full rounded-xl max-h-[70vh]" /></div>}
          {state.phase === "audio" && <div className="p-4"><audio src={proxyUrl} controls className="w-full" /></div>}
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
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] active:bg-[var(--surface2)] transition-colors text-left"
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#ffe8ed", color: "#ff2d55" }}>
        {resolving ? (
          <Spinner size={18} color="#ff2d55" />
        ) : (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] text-[var(--fg)] truncate">{mod.name}</p>
        {externalUrl && <p className="text-[11px] text-[var(--secondary)] truncate">{externalUrl}</p>}
      </div>
      <svg className="w-4 h-4 text-[var(--secondary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
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
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] active:bg-[var(--surface2)] transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-bold" style={{ background: "#e8f8ed", color: "#34c759", fontSize: "7px" }}>
          Tarea
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] text-[var(--fg)] truncate">{mod.name}</p>
        </div>
        <svg className={`w-4 h-4 text-[var(--secondary)] shrink-0 transition-transform ${open ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[rgba(60,60,67,0.08)]" style={{ background: "#fafafa" }}>
          {fetching && (
            <div className="flex items-center justify-center gap-2.5 h-20">
              <Spinner size={20} color="#34c759" />
              <span className="text-[13px] font-medium text-[var(--secondary)]">Cargando tarea…</span>
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
                      <p className="text-[11px] font-semibold text-[var(--secondary)] uppercase tracking-wide w-16 shrink-0 pt-0.5">{d.label}</p>
                      <p className="text-[13px] text-[var(--fg)] font-medium">{d.value}</p>
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
                  <p className="text-[14px] font-semibold text-[var(--fg)]">{submissionVal}</p>
                </div>
              )}

              {/* Time remaining */}
              {timeRow && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[12px] text-[var(--secondary)]">{timeRow.label}:</span>
                  <span className={`text-[12px] font-medium ${isOverdue ? "text-[#ff9500]" : "text-[var(--fg)]"}`}>
                    {timeRow.value}
                  </span>
                </div>
              )}

              {/* Grade */}
              {gradeRow && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[12px] text-[var(--secondary)]">{gradeRow.label}:</span>
                  <span className="text-[12px] font-medium text-[var(--fg)]">{gradeRow.value}</span>
                </div>
              )}

              {/* Other status rows */}
              {otherRows.map((r, i) => (
                <div key={i} className="flex items-start gap-2 px-1">
                  <span className="text-[12px] text-[var(--secondary)] shrink-0">{r.label}:</span>
                  <span className="text-[12px] text-[var(--fg)]">{r.value}</span>
                </div>
              ))}

              {/* Description */}
              {info.description && (
                <div className="bg-white rounded-xl px-3 py-3 shadow-sm">
                  <p className="text-[12px] text-[var(--secondary)] leading-relaxed">{info.description}</p>
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
    if (mod.description) {
      // Skip labels that only contain links and no real body text.
      // e.g. institutional navigation labels: <a href="...">RIA</a>
      const textOnly = mod.description.replace(/<a[\s\S]*?<\/a>/gi, "").replace(/<[^>]+>/g, "").trim();
      if (!textOnly) return null;

      return (
        <div
          className="px-4 py-3 text-[13px] text-[var(--fg)] leading-relaxed label-content"
          dangerouslySetInnerHTML={{ __html: mod.description }}
        />
      );
    }
    return (
      <div className="px-4 py-2 text-[13px] text-[var(--secondary)] italic">
        {mod.name}
      </div>
    );
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
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] active:bg-[var(--surface2)] transition-colors text-left"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-bold"
          style={{ background: bg, color, fontSize: badgeFontSize }}
        >
          {badge}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] text-[var(--fg)] truncate">{mod.name}</p>
        </div>
        {(isPreviewable || mod.url) && (
          <svg
            className={`w-4 h-4 text-[var(--secondary)] shrink-0 transition-transform ${isPreviewable && open ? "rotate-90" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          >
            <polyline points="9,18 15,12 9,6" />
          </svg>
        )}
      </button>

      {isPreviewable && open && (
        <div className="border-t border-[rgba(60,60,67,0.08)] bg-[var(--surface2)] divide-y divide-[rgba(60,60,67,0.06)]">
          {mod.contents!.map((c, i) => <FileViewer key={i} content={c} />)}
        </div>
      )}
    </div>
  );
}

// ─── SectionAccordion ─────────────────────────────────────────────────────────

// Institutional navigation links added automatically to all UTN courses — never useful to students.
const INSTITUTIONAL_LINKS = new Set(["RIA", "eLibro", "Biblioteca", "Estudiantes", "Docentes"]);
const isVisible = (m: MoodleModule) => m.visible !== 0 && !INSTITUTIONAL_LINKS.has(m.name);

function SectionAccordion({ section, defaultOpen }: {
  section: { id: number; name: string; summaryHtml?: string; modules: MoodleModule[] };
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const visibleMods = section.modules.filter((m) => isVisible(m) && m.modname !== "label");

  return (
    <div className="bg-[var(--surface)] rounded-2xl overflow-hidden shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-4 text-left hover:bg-[var(--surface2)] transition-colors">
        <div>
          <p className="text-[16px] font-semibold text-[var(--fg)]">{section.name || "General"}</p>
          <p className="text-[12px] text-[var(--secondary)] mt-0.5">{visibleMods.length} elemento{visibleMods.length !== 1 ? "s" : ""}</p>
        </div>
        <svg className={`w-5 h-5 text-[var(--secondary)] transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <polyline points="6,9 12,15 18,9" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-[rgba(60,60,67,0.1)]">
          {section.summaryHtml && (
            <div
              className="prose prose-sm max-w-none dark:prose-invert px-4 py-3 border-b border-[var(--separator)]
                prose-p:text-[var(--fg)] dark:prose-p:text-[var(--fg)] prose-p:leading-relaxed prose-p:my-1
                prose-a:text-[var(--accent)] prose-a:no-underline hover:prose-a:underline
                prose-strong:text-[var(--fg)] prose-strong:font-semibold
                prose-ul:pl-4 prose-ol:pl-4 prose-li:text-[var(--fg)] dark:prose-li:text-[var(--fg)] prose-li:my-0.5
                prose-headings:text-[var(--fg)] dark:prose-headings:text-[var(--fg)] prose-headings:font-semibold
                prose-img:rounded-lg prose-img:my-2"
              style={{ background: "var(--surface2)" }}
            >
              {parse(section.summaryHtml)}
            </div>
          )}
          <div className="divide-y divide-[rgba(60,60,67,0.06)]">
            {section.modules.filter(isVisible).map((mod) => <ModuleRow key={mod.id} mod={mod} />)}
          </div>
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
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar fullname={userInfo.fullname} />
      {/*
        WorkspaceLayout manages the split-panel. It provides PdfPreviewContext
        so any FileViewer nested inside can push PDFs to the right panel.
        It also handles max-width: single-column uses max-w-2xl centred,
        split mode expands to max-w-[1600px].
      */}
      <WorkspaceLayout>
        <div className="py-6">
          {/* Back link */}
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-[15px] text-[var(--accent)] font-medium mb-5 hover:opacity-70 transition-opacity">
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
                  <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: "4px" }}>
                    Materia
                  </p>
                  <h1 style={{ fontSize: "clamp(22px, 5vw, 30px)", fontWeight: "800", color: "var(--fg)", lineHeight: "1.1", letterSpacing: "-0.5px", margin: 0 }}>
                    {courseName}
                  </h1>
                  {!loading && (
                    <p style={{ fontSize: "13px", color: "var(--secondary)", marginTop: "6px" }}>
                      {visible.length} sección{visible.length !== 1 ? "es" : ""}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {loading && (
            <div className="bg-[var(--surface)] rounded-2xl shadow-sm overflow-hidden">
              <SpinnerBlock label="Cargando secciones…" size={30} minHeight={200} />
            </div>
          )}
          {error && <div className="bg-[#fff2f2] border border-[#ffcdd2] rounded-2xl p-5 text-[#ff3b30] text-sm">{error}</div>}
          {!loading && !error && (
            <div className="space-y-3">
              {visible.map((s, i) => <SectionAccordion key={s.id} section={s} defaultOpen={i === 0} />)}
              {visible.length === 0 && <p className="text-center py-16 text-[var(--secondary)] text-[15px]">Sin contenido visible todavía.</p>}
            </div>
          )}
        </div>
      </WorkspaceLayout>
    </div>
  );
}
