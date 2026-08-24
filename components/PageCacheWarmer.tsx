"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Cada vez que cambia la ruta (incluidos los query params — ej. /dashboard/
 * calendario?plan=ingenierias vs ?plan=tecnicatura, son documentos
 * distintos), dispara en segundo plano un pedido normal (sin header RSC) a
 * esa misma URL completa — el Service Worker lo guarda como si fuera una
 * navegación dura (ver public/sw.js), así páginas dinámicas como
 * /materia/[slug] o rutas con query quedan disponibles offline aunque el
 * usuario solo haya entrado navegando normal adentro de la app, sin
 * recargar nunca. Necesita useSearchParams(), por eso se monta envuelto en
 * <Suspense> desde app/layout.tsx.
 */
export default function PageCacheWarmer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    if (typeof navigator === "undefined" || navigator.onLine === false) return;
    const url = search ? `${pathname}?${search}` : pathname;
    fetch(url).catch(() => { /* silencioso — es un warm-up en segundo plano */ });
  }, [pathname, search]);

  return null;
}
