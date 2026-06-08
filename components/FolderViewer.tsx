"use client";

import { useCallback, useState } from "react";
import Spinner from "@/components/Spinner";
import { FileViewer } from "@/components/CourseFileViewer";
import type { MoodleContent, MoodleModule } from "@/lib/moodle";

// Mirrors the shape returned by GET /api/folder (see app/api/folder/route.ts).
export type FolderNode =
  | { type: "file"; name: string; url: string; fileType?: string }
  | { type: "folder"; name: string; children: FolderNode[] };

type FolderData = {
  name: string;
  intro?: string;
  downloadUrl: string;
  entries: FolderNode[];
};

function folderIdFromUrl(url?: string): string | null {
  if (!url) return null;
  return url.match(/[?&]id=(\d+)/)?.[1] ?? null;
}

const DownloadIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7,10 12,15 17,10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

// ─── A single file row inside the folder ────────────────────────────────────
// Reuses the shared FileViewer so folder files preview (PDF/DOCX/XLSX/PPTX in the
// workspace panel, images/video/audio inline) exactly like course resources.
function FileNodeRow({ node, depth }: { node: Extract<FolderNode, { type: "file" }>; depth: number }) {
  const content: MoodleContent = {
    type: "file",
    filename: node.name,
    filesize: 0,
    fileurl: node.url,
    timemodified: 0,
    fileType: node.fileType,
  };
  if (depth === 0) return <FileViewer content={content} />;
  return (
    <div style={{ paddingLeft: `${depth * 16}px` }}>
      <FileViewer content={content} />
    </div>
  );
}

// ─── A subfolder row — collapsible, recurses into children ───────────────────
function SubfolderRow({ node, depth }: { node: Extract<FolderNode, { type: "folder" }>; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] transition-colors text-left"
        style={{ paddingLeft: `${16 + depth * 16}px` }}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#fff3e0", color: "#ff9500" }}>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        </div>
        <p className="flex-1 min-w-0 text-[14px] font-medium text-[var(--fg)] truncate">{node.name}</p>
        <svg
          className={`w-4 h-4 text-[var(--secondary)] shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        >
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </button>
      {open && (
        <div className="divide-y divide-[rgba(60,60,67,0.06)]">
          {node.children.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-[var(--secondary)] italic" style={{ paddingLeft: `${16 + (depth + 1) * 16}px` }}>
              Carpeta vacía
            </p>
          ) : (
            node.children.map((child, i) =>
              child.type === "file" ? (
                <FileNodeRow key={i} node={child} depth={depth + 1} />
              ) : (
                <SubfolderRow key={i} node={child} depth={depth + 1} />
              )
            )
          )}
        </div>
      )}
    </div>
  );
}

// ─── FolderViewer — the folder module row + its expandable contents ──────────
export default function FolderViewer({ mod }: { mod: MoodleModule }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<FolderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = folderIdFromUrl(mod.url);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    // Lazy-load the folder contents on first expand.
    if (next && !data && !loading && id) {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/folder?id=${id}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "No se pudo abrir la carpeta");
        setData(j.data as FolderData);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
  }, [open, data, loading, id]);

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] active:bg-[var(--surface2)] transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#fff3e0", color: "#ff9500" }}>
          <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] text-[var(--fg)] truncate">{mod.name}</p>
        </div>
        <svg
          className={`w-4 h-4 text-[var(--secondary)] shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        >
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[rgba(60,60,67,0.08)] bg-[var(--surface2)]">
          {loading && (
            <div className="flex items-center justify-center gap-2.5 h-16">
              <Spinner size={18} color="#ff9500" />
              <span className="text-[13px] text-[var(--secondary)]">Cargando carpeta…</span>
            </div>
          )}

          {error && (
            <div className="px-4 py-3 text-[13px] text-[#ff3b30]">{error}</div>
          )}

          {data && !loading && (
            <>
              {data.intro && (
                <p className="px-4 pt-3 pb-1 text-[13px] text-[var(--secondary)] leading-relaxed">{data.intro}</p>
              )}

              <div className="divide-y divide-[rgba(60,60,67,0.06)]">
                {data.entries.length === 0 ? (
                  <p className="px-4 py-5 text-center text-[13px] text-[var(--secondary)]">Esta carpeta está vacía.</p>
                ) : (
                  data.entries.map((node, i) =>
                    node.type === "file" ? (
                      <FileNodeRow key={i} node={node} depth={0} />
                    ) : (
                      <SubfolderRow key={i} node={node} depth={0} />
                    )
                  )
                )}
              </div>

              {data.entries.length > 0 && (
                <div className="px-4 py-3 border-t border-[rgba(60,60,67,0.08)]">
                  <a
                    href={`/api/files?url=${encodeURIComponent(data.downloadUrl)}`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-[var(--surface)] border border-[var(--separator)] text-[13px] font-semibold text-[var(--accent)] active:opacity-70 transition-opacity"
                  >
                    <DownloadIcon className="w-4 h-4" />
                    Descargar carpeta (.zip)
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
