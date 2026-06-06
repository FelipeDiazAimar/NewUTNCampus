"use client";

import { useEffect } from "react";
import { Sparkles, X } from "lucide-react";

interface ComingSoonModalProps {
  open: boolean;
  title?: string;
  onClose: () => void;
}

/**
 * Modal iOS-style (fondo translúcido con blur, tarjeta rounded-3xl) para avisar
 * que una opción del menú todavía no está disponible.
 */
export default function ComingSoonModal({ open, title, onClose }: ComingSoonModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", animation: "fade-in 0.2s ease" }}
      role="dialog"
      aria-modal="true"
    >
      <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={onClose} />

      <div className="relative w-full max-w-[320px] rounded-3xl border border-[var(--separator)] bg-[var(--surface)]/90 backdrop-blur-xl p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 w-8 h-8 rounded-full bg-[var(--surface2)] flex items-center justify-center active:opacity-70"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4 text-[var(--secondary)]" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-[22px] bg-[var(--accent-light)] flex items-center justify-center mb-4 shadow-sm">
            <Sparkles className="w-8 h-8 text-[#af52de]" />
          </div>
          <h2 className="text-[18px] font-bold text-[var(--fg)] tracking-tight">
            {title ?? "Próximamente"}
          </h2>
          <p className="text-[14px] text-[var(--secondary)] mt-1.5 leading-relaxed">
            Este módulo no está disponible todavía. Estamos trabajando para sumarlo pronto.
          </p>

          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full py-3 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 transition-opacity shadow-sm"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
