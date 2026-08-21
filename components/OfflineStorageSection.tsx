"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSpreadsheet, FileText, Presentation, File as FileIcon, Trash2 } from "lucide-react";
import {
  clearAll,
  deleteFile,
  deleteFilesByMateria,
  getTotalSize,
  isStorageFull,
  listFiles,
  type OfflineFileRecord,
} from "@/lib/offlineFileCache";
import { formatBytes } from "@/components/CourseFileViewer";

type TypeStyle = { Icon: typeof FileText; bg: string; fg: string };

function typeStyle(mimeType: string, fileName: string): TypeStyle {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType.includes("pdf") || ext === "pdf") return { Icon: FileText, bg: "#ffe8e7", fg: "#ff3b30" };
  if (mimeType.includes("wordprocessingml") || mimeType.includes("msword") || ext === "docx")
    return { Icon: FileText, bg: "#e8f4fd", fg: "#007aff" };
  if (mimeType.includes("spreadsheetml") || mimeType.includes("ms-excel") || ["xlsx", "xls", "csv"].includes(ext))
    return { Icon: FileSpreadsheet, bg: "#e8f8ed", fg: "#34c759" };
  if (mimeType.includes("presentationml") || mimeType.includes("mspowerpoint") || ext === "pptx")
    return { Icon: Presentation, bg: "#fff3e0", fg: "#ff9500" };
  return { Icon: FileIcon, bg: "var(--surface2)", fg: "var(--secondary)" };
}

function groupByMateria(files: OfflineFileRecord[]): [string, string, OfflineFileRecord[]][] {
  const map = new Map<string, { nombre: string; files: OfflineFileRecord[] }>();
  for (const f of files) {
    if (!map.has(f.materiaId)) map.set(f.materiaId, { nombre: f.materiaNombre, files: [] });
    map.get(f.materiaId)!.files.push(f);
  }
  return [...map.entries()].map(([id, { nombre, files: fs }]) => [
    id,
    nombre,
    [...fs].sort((a, b) => b.sizeBytes - a.sizeBytes),
  ]);
}

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));

export default function OfflineStorageSection() {
  const [filesEnabled, setFilesEnabled] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [files, setFiles] = useState<OfflineFileRecord[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [openMateria, setOpenMateria] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshFiles = useCallback(async () => {
    const [list, size] = await Promise.all([listFiles(), getTotalSize()]);
    setFiles(list);
    setTotalSize(size);
  }, []);

  useEffect(() => {
    fetcher("/api/offline-preferences").then((j) => {
      if (j) setFilesEnabled(j.filesEnabled === true);
      setLoadingPrefs(false);
    });
    refreshFiles();
  }, [refreshFiles]);

  async function toggle() {
    const next = !filesEnabled;
    setFilesEnabled(next);
    await fetch("/api/offline-preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filesEnabled: next }),
    }).catch(() => {});
  }

  async function removeFile(key: string) {
    setBusy(true);
    await deleteFile(key);
    await refreshFiles();
    setBusy(false);
  }

  async function removeMateria(materiaId: string) {
    setBusy(true);
    await deleteFilesByMateria(materiaId);
    await refreshFiles();
    setBusy(false);
  }

  async function removeAll() {
    setBusy(true);
    await clearAll();
    await refreshFiles();
    setBusy(false);
  }

  const groups = groupByMateria(files);

  return (
    <section className="mb-7">
      <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
        Almacenamiento offline
      </p>

      <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm">
        <button
          type="button"
          onClick={toggle}
          disabled={loadingPrefs}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-black/5 dark:active:bg-white/5 disabled:opacity-60"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium text-[var(--fg)]">Guardar archivos para uso offline</span>
            <span className="block text-[12px] text-[var(--secondary)]">
              Guarda automáticamente los archivos que abrís para verlos sin internet
            </span>
          </span>
          <span
            className={`relative shrink-0 w-11 rounded-full transition-colors ${filesEnabled ? "bg-[#34c759]" : "bg-[var(--surface2)]"}`}
            style={{ height: "26px" }}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${filesEnabled ? "translate-x-[18px]" : ""}`}
            />
          </span>
        </button>

        <div className="px-4 py-3 border-t border-[var(--separator)]">
          <p className="text-[13px] text-[var(--secondary)]">
            Espacio usado: <span className="font-medium text-[var(--fg)]">{formatBytes(totalSize) || "0 B"}</span>
          </p>
          {isStorageFull() && (
            <p className="mt-1 text-[12px] text-[#ff9500]">
              Espacio insuficiente en el dispositivo — borrá algunos archivos para seguir guardando offline.
            </p>
          )}
        </div>
      </div>

      {groups.length > 0 && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={removeAll}
            className="mt-3 w-full rounded-[14px] border border-[rgba(255,59,48,0.3)] bg-[var(--surface)] py-3 text-[14px] font-semibold text-[#ff3b30] shadow-sm transition-opacity active:opacity-80 disabled:opacity-40"
          >
            Borrar todo
          </button>

          <div className="mt-3 overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm divide-y divide-[var(--separator)]">
            {groups.map(([materiaId, materiaNombre, list]) => {
              const open = openMateria === materiaId;
              return (
                <div key={materiaId}>
                  <button
                    type="button"
                    onClick={() => setOpenMateria(open ? null : materiaId)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <span className="flex-1 min-w-0 text-[14px] font-medium text-[var(--fg)] truncate">{materiaNombre}</span>
                    <span className="text-[12px] text-[var(--secondary)]">{list.length}</span>
                  </button>
                  {open && (
                    <div className="divide-y divide-[rgba(60,60,67,0.06)] bg-[var(--surface2)]">
                      {list.map((f) => {
                        const { Icon, bg, fg } = typeStyle(f.mimeType, f.fileName);
                        return (
                          <div key={f.key} className="flex items-center gap-3 px-4 py-2.5">
                            <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: bg, color: fg }}>
                              <Icon className="w-4 h-4" />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[13px] text-[var(--fg)] truncate">{f.fileName}</span>
                              <span className="block text-[11px] text-[var(--secondary)]">{formatBytes(f.sizeBytes)}</span>
                            </span>
                            <button
                              disabled={busy}
                              onClick={() => removeFile(f.key)}
                              className="shrink-0 text-[var(--secondary)] hover:text-[#ff3b30] transition-colors disabled:opacity-40"
                              aria-label={`Borrar ${f.fileName}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                      <div className="px-4 py-2.5">
                        <button
                          disabled={busy}
                          onClick={() => removeMateria(materiaId)}
                          className="text-[12px] font-semibold text-[#ff3b30] disabled:opacity-40"
                        >
                          Borrar todos los apuntes de esta materia
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
