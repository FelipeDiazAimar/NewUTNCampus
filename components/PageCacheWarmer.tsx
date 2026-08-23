"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Cada vez que cambia la ruta, dispara en segundo plano un pedido normal
 * (sin header RSC) a la misma URL — el Service Worker lo guarda como si
 * fuera una navegación dura (ver public/sw.js), así páginas dinámicas como
 * /materia/[slug] quedan disponibles offline aunque el usuario solo haya
 * entrado navegando normal adentro de la app, sin recargar nunca.
 */
export default function PageCacheWarmer() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof navigator === "undefined" || navigator.onLine === false) return;
    fetch(pathname).catch(() => { /* silencioso — es un warm-up en segundo plano */ });
  }, [pathname]);

  return null;
}
