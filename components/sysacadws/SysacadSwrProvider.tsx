"use client";

import { SWRConfig } from "swr";
import type { Cache, State } from "swr";
import type { ReactNode } from "react";

const STORAGE_KEY = "sysacad-swr-cache-v1";

/**
 * Los endpoints del WS de Sysacad son lentos (varios segundos cada uno, en
 * paralelo, servidor viejo de la facultad — no depende de nosotros). Guardar
 * la caché de SWR en localStorage hace que, al volver a /sysacad (aunque sea
 * otro día), la página abra al instante con los últimos datos conocidos
 * mientras SWR revalida atrás, en vez de arrancar de cero cada vez.
 *
 * Solo se scopea a este layout (envuelve /sysacad y /sysacad/inscripcion) para
 * no tocar la caché en memoria del resto de la app.
 */
function localStorageProvider(): Cache {
  const map = new Map<string, State>(
    (() => {
      if (typeof window === "undefined") return [];
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      } catch {
        return [];
      }
    })()
  );

  if (typeof window !== "undefined") {
    const persist = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(map.entries())));
      } catch {
        // Cuota de localStorage llena o modo privado: sin caché persistida, no rompe nada.
      }
    };
    // beforeunload no siempre dispara en mobile (Safari puede saltarlo al
    // cerrar la pestaña); visibilitychange cubre ese caso al pasar la app a
    // segundo plano.
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") persist();
    });
  }

  return map;
}

export default function SysacadSwrProvider({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: localStorageProvider }}>{children}</SWRConfig>;
}
