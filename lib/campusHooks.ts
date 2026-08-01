"use client";

import useSWR from "swr";
import type { CampusCatalogo, MatricularResult } from "@/lib/campus";

const SWR_CFG = {
  revalidateOnFocus: false,
  dedupingInterval: 5 * 60_000,
  keepPreviousData: true,
} as const;

async function jsonOk<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const e = new Error("fetch failed") as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return r.json() as Promise<T>;
}

/** Clave SWR del catálogo — exportada para poder revalidarlo tras matricular. */
export function campusCatalogoKey(especialidad?: string): string | null {
  return especialidad
    ? `/api/campus/catalogo?especialidad=${encodeURIComponent(especialidad)}`
    : null;
}

export function useCampusCatalogo(especialidad?: string) {
  return useSWR<CampusCatalogo>(campusCatalogoKey(especialidad), jsonOk, SWR_CFG);
}

/** Matricula al alumno en un curso del campus. Nunca lanza. */
export async function postMatricular(courseId: string, clave: string): Promise<MatricularResult> {
  try {
    const r = await fetch("/api/campus/matricular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, clave }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, motivo: j.error ?? "No se pudo matricular en el campus." };
    return j as MatricularResult;
  } catch {
    return { ok: false, motivo: "No se pudo conectar. Revisá tu conexión." };
  }
}
