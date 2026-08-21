"use client";

import { useEffect, useState } from "react";
import { WifiOff, X } from "lucide-react";

/**
 * Modal global que aparece cuando una acción de escritura se intenta sin
 * conexión. Escucha el evento custom "campus:offlineblock" emitido por
 * triggerOfflineBlock() desde cualquier componente.
 *
 * Agrega <OfflineBlockModal /> una sola vez en el root layout, junto a
 * <GuestBlockModal />.
 */
export default function OfflineBlockModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("campus:offlineblock", handler);
    return () => window.removeEventListener("campus:offlineblock", handler);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Acción no disponible sin conexión"
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

        <div className="px-6 pt-7 pb-6 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-[rgba(255,149,0,0.12)] flex items-center justify-center mb-1">
            <WifiOff className="w-7 h-7 text-[#ff9500]" />
          </div>

          <h2 className="text-[17px] font-semibold text-[var(--fg)]">
            Necesitás conexión a internet
          </h2>
          <p className="text-[14px] text-[var(--secondary)] leading-snug">
            Esta acción no está disponible sin conexión. Conectate a internet
            para poder continuar.
          </p>
        </div>

        <div className="px-4 pb-5">
          <button
            onClick={() => setOpen(false)}
            className="w-full py-3 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 transition-opacity"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
