"use client";

import { useEffect, useState } from "react";
import { formatEntries, getRecentDiagnostics, type DiagEntry } from "@/lib/offlineDiagnostics";

// TEMPORAL — debug del guardado offline. Muestra en pantalla los últimos
// pasos que registró el Service Worker (ver public/sw.js::diagLog) para que
// se puedan copiar y pegar directamente, sin depender de reconectar ni de
// tener acceso a DevTools/Mac. Sacar cuando el guardado offline esté
// funcionando de forma confiable.
export default function OfflinePage() {
  const [entries, setEntries] = useState<DiagEntry[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getRecentDiagnostics(40).then(setEntries);
  }, []);

  const text = formatEntries(entries);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* el <textarea> de abajo sirve de respaldo para seleccionar a mano */
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-6 py-10">
      <div className="text-center max-w-md w-full">
        <h1 className="text-[20px] font-semibold text-[var(--fg)] mb-2">Sin conexión</h1>
        <p className="text-[14px] text-[var(--secondary)] mb-6">
          Esta página todavía no se guardó para verse sin internet. Conectate y volvé a intentar.
        </p>

        <div className="text-left">
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
            className="w-full h-64 rounded-xl border border-[var(--separator)] bg-[var(--surface)] p-3 text-[11px] font-mono text-[var(--fg)] resize-none"
          />
        </div>
      </div>
    </div>
  );
}
