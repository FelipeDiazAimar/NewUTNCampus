"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, X } from "lucide-react";
import { isGuestMode } from "@/lib/guest";

/**
 * Modal global que aparece cuando una acción de escritura se intenta desde el
 * modo invitado. Escucha el evento custom "campus:guestblock" emitido por
 * triggerGuestBlock() desde cualquier componente.
 *
 * Agrega <GuestBlockModal /> una sola vez en el root layout.
 */
export default function GuestBlockModal() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const handler = () => {
      if (isGuestMode()) setOpen(true);
    };
    window.addEventListener("campus:guestblock", handler);
    return () => window.removeEventListener("campus:guestblock", handler);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Acción no disponible"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        className="relative w-full max-w-sm bg-[var(--surface)] rounded-3xl shadow-2xl border border-[var(--separator)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 p-1.5 rounded-full text-[var(--secondary)] hover:bg-[var(--surface2)] transition-colors"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 pt-7 pb-6 flex flex-col items-center text-center gap-3">
          {/* Icon */}
          <div className="w-14 h-14 rounded-full bg-[rgba(0,122,255,0.1)] flex items-center justify-center mb-1">
            <LogIn className="w-7 h-7 text-[#007aff]" />
          </div>

          <h2 className="text-[17px] font-semibold text-[var(--fg)]">
            Iniciá sesión para continuar
          </h2>
          <p className="text-[14px] text-[var(--secondary)] leading-snug">
            Esta acción no está disponible en el modo invitado. Iniciá sesión con
            tus credenciales del Campus UTN para usar esta función.
          </p>
        </div>

        <div className="px-4 pb-5 flex flex-col gap-2">
          <button
            onClick={() => { setOpen(false); router.push("/"); }}
            className="w-full py-3 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 transition-opacity"
          >
            Ir al inicio de sesión
          </button>
          <button
            onClick={() => setOpen(false)}
            className="w-full py-2.5 rounded-2xl text-[#007aff] font-medium text-[14px] active:opacity-70"
          >
            Seguir explorando
          </button>
        </div>
      </div>
    </div>
  );
}
