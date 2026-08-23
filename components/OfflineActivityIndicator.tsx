"use client";

import { useEffect, useRef, useState } from "react";
import { isPwaStandalone } from "@/lib/pwa";

type Phase = "idle" | "drawing" | "fading";

/**
 * Traza el contorno del header en azul mientras se guarda algo para uso
 * offline (archivo o datos de la vista actual), y lo desvanece al terminar.
 * Escucha "campus:offline-activity" (ver lib/offlineActivity.ts). Debe
 * montarse dentro de un contenedor con position: relative del tamaño del
 * header (el pill de Navbar ya lo tiene). Solo se muestra en PWA instalada
 * (standalone) — en el navegador normal no tiene sentido, es ruido visual.
 */
export default function OfflineActivityIndicator() {
  const [isPwa, setIsPwa] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const fadeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIsPwa(isPwaStandalone());
  }, []);

  useEffect(() => {
    if (!isPwa) return;
    function handler(e: Event) {
      const active = (e as CustomEvent<{ active: boolean }>).detail?.active;
      if (fadeTimeout.current) {
        clearTimeout(fadeTimeout.current);
        fadeTimeout.current = null;
      }
      if (active) {
        setPhase("drawing");
      } else {
        setPhase("fading");
        fadeTimeout.current = setTimeout(() => setPhase("idle"), 450);
      }
    }
    window.addEventListener("campus:offline-activity", handler);
    return () => {
      window.removeEventListener("campus:offline-activity", handler);
      if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
    };
  }, [isPwa]);

  if (!isPwa) return null;

  const drawn = phase === "drawing" || phase === "fading";

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 20 }} aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="calc(100% - 2px)"
        height="calc(100% - 2px)"
        rx="16"
        ry="15"
        fill="none"
        stroke="#007aff"
        strokeWidth="1.5"
        pathLength={100}
        strokeDasharray={100}
        strokeDashoffset={drawn ? 0 : 100}
        style={{
          opacity: phase === "fading" ? 0 : phase === "drawing" ? 1 : 0,
          transition:
            phase === "drawing"
              ? "stroke-dashoffset 700ms ease"
              : phase === "fading"
                ? "opacity 400ms ease"
                : "none",
        }}
      />
    </svg>
  );
}
