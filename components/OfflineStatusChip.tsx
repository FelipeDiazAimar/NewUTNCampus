"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { formatEntries, getRecentDiagnostics, type DiagEntry } from "@/lib/offlineDiagnostics";

// TEMPORAL — debug del guardado offline. El chip abre un modal con el
// diagnóstico del Service Worker, accesible desde CUALQUIER pantalla que
// llegue a renderizar (el chip vive en el header, global) — pensado para
// cuando ni /offline ni la vista que falló llegan a mostrarse (visto en iOS).
// Sacar cuando el guardado offline esté funcionando de forma confiable.
export default function OfflineStatusChip() {
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DiagEntry[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  function openDiag() {
    getRecentDiagnostics(60).then(setEntries);
    setOpen(true);
  }

  const text = formatEntries(entries);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* el <textarea> del modal sirve de respaldo para seleccionar a mano */
    }
  }

  if (!offline) return null;

  return (
    <>
      <button
        type="button"
        onClick={openDiag}
        className="flex items-center gap-1.5 rounded-full bg-[rgba(52,199,89,0.14)] px-2.5 py-1 text-[12px] font-semibold text-[#248a3d] dark:text-[#34c759]"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34c759] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34c759]" />
        </span>
        Modo Offline
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          // Portal a document.body: el <header> de Navbar tiene will-change-transform,
          // que crea un containing block para position:fixed — sin el portal, este
          // modal quedaba anclado al header en vez de centrado en toda la pantalla.
          <div
            className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Diagnóstico offline"
            onClick={() => setOpen(false)}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-sm bg-[var(--surface)] rounded-3xl shadow-2xl border border-[var(--separator)] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setOpen(false)}
                className="absolute top-3 right-3 p-1.5 rounded-full text-[var(--secondary)] hover:bg-[var(--surface2)] transition-colors"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="px-5 pt-6 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                    Diagnóstico ({entries.length} pasos)
                  </p>
                  <button
                    onClick={copy}
                    disabled={entries.length === 0}
                    className="text-[12px] font-semibold text-[#007aff] active:opacity-70 disabled:opacity-40"
                  >
                    {copied ? "Copiado ✓" : "Copiar"}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={entries.length > 0 ? text : "Sin pasos registrados todavía."}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full h-64 rounded-xl border border-[var(--separator)] bg-[var(--surface2)] p-3 text-[11px] font-mono text-[var(--fg)] resize-none"
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
