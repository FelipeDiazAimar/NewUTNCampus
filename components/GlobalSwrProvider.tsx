"use client";

import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { reportClientError } from "@/lib/clientErrorReporter";

/**
 * Envuelve toda la app: cualquier useSWR (directo o vía lib/sysacadHooks,
 * lib/campusHooks, etc.) que falle reporta acá, sin tener que instrumentar
 * cada hook de carga de sección a mano. 401/403 no se reportan: son flujos
 * de sesión esperados (re-login), no errores reales.
 */
export default function GlobalSwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        onError: (err, key) => {
          const status = (err as { status?: number })?.status;
          if (status === 401 || status === 403) return;
          reportClientError("warning", `SWR ${key}: ${err?.message ?? "fetch failed"}`, {
            stack: err instanceof Error ? (err.stack ?? null) : null,
          });
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
