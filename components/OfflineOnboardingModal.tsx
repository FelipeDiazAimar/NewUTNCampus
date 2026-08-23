"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { isPwaStandalone } from "@/lib/pwa";

/**
 * Aparece una sola vez, solo en PWA instalada, la primera vez que el usuario
 * entra a /materias. Pregunta si además de los datos (que se guardan
 * automáticamente) quiere guardar también los archivos que abra.
 */
export default function OfflineOnboardingModal() {
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isPwaStandalone()) return;
    fetch("/api/offline-preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.onboardingSeen === false) setVisible(true); })
      .catch(() => { /* no molestar si falla — se puede activar luego desde /configuracion */ });
  }, []);

  async function choose(filesEnabled: boolean) {
    setSaving(true);
    try {
      await fetch("/api/offline-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filesEnabled, onboardingSeen: true }),
      });
    } finally {
      setSaving(false);
      setVisible(false);
    }
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Guardado offline"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div className="relative w-full max-w-sm bg-[var(--surface)] rounded-3xl shadow-2xl border border-[var(--separator)] overflow-hidden">
        <button
          onClick={() => choose(false)}
          disabled={saving}
          className="absolute top-3 right-3 p-1.5 rounded-full text-[var(--secondary)] hover:bg-[var(--surface2)] transition-colors disabled:opacity-40"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 pt-7 pb-6 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-[rgba(0,122,255,0.1)] flex items-center justify-center mb-1">
            <Download className="w-7 h-7 text-[#007aff]" />
          </div>

          <h2 className="text-[17px] font-semibold text-[var(--fg)]">
            Tu campus, también sin señal
          </h2>
          <p className="text-[14px] text-[var(--secondary)] leading-snug">
            Guardamos tus materias, horarios, notas y agenda automáticamente
            para que los veas sin conexión. ¿Guardamos también los archivos
            que abras, para leerlos offline?
          </p>
        </div>

        <div className="px-4 pb-5 flex flex-col gap-2">
          <button
            onClick={() => choose(true)}
            disabled={saving}
            className="w-full py-3 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 transition-opacity disabled:opacity-60"
          >
            Guardar archivos también
          </button>
          <button
            onClick={() => choose(false)}
            disabled={saving}
            className="w-full py-2.5 rounded-2xl text-[#007aff] font-medium text-[14px] active:opacity-70 disabled:opacity-60"
          >
            Solo los datos, por ahora
          </button>
        </div>
      </div>
    </div>
  );
}
