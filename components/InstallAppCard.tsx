"use client";

import { useEffect, useState } from "react";
import { Share, Smartphone } from "lucide-react";

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Aviso para instalar la PWA. Se oculta si ya se está corriendo en modo
 * standalone (instalada), y si `mobileOnly` está activo también se oculta en
 * desktop — pensado para lugares donde solo tiene sentido en el teléfono
 * (p. ej. el final del dashboard), a diferencia de /notificaciones donde se
 * muestra siempre que no esté instalada.
 */
export default function InstallAppCard({ mobileOnly = false }: { mobileOnly?: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    if (mobileOnly && !isMobileDevice()) return;
    setVisible(true);
  }, [mobileOnly]);

  if (!visible) return null;

  return (
    <section className="mb-7">
      <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#007aff1a] text-[#007aff] dark:text-[#0a84ff]">
            <Smartphone className="h-[22px] w-[22px]" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[var(--fg)]">Instalá la app</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--secondary)]">
              Para una experiencia completa y recibir alertas en segundo plano, instalá esta app:
              en iOS tocá{" "}
              <span className="inline-flex items-center gap-0.5 font-medium text-[var(--fg)]">
                Compartir <Share className="inline h-3.5 w-3.5" />
              </span>{" "}
              y luego <span className="font-medium text-[var(--fg)]">«Agregar a la pantalla de inicio»</span>; en
              Android, <span className="font-medium text-[var(--fg)]">«Instalar aplicación»</span>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
