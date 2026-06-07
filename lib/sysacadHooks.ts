"use client";

import useSWR from "swr";
import type { SysacadAvance, SysacadCursado, SysacadExamenes, SysacadPlan } from "@/lib/sysacadws";
import type { MateriaEstado, MateriaCorrelativa } from "@/lib/sysacad";

/**
 * Hooks de datos de Sysacad con SWR. La caché en memoria de SWR es global y
 * persiste entre navegaciones del cliente → al volver a /sysacad la data aparece
 * al instante mientras revalida en segundo plano.
 */
const SWR_CFG = {
  revalidateOnFocus: false,
  dedupingInterval: 5 * 60_000,
  keepPreviousData: true,
} as const;

type WithStatus = Error & { status?: number };

async function jsonOk<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const e = new Error("fetch failed") as WithStatus;
    e.status = r.status;
    throw e;
  }
  return r.json() as Promise<T>;
}

// Datos del web service (Basic legajo:DNI, no expira).
export function useCursado(legajo?: string) {
  return useSWR<SysacadCursado>(legajo ? `/api/sysacadws/cursado/coninasistencia/${legajo}` : null, jsonOk, SWR_CFG);
}
export function useAvance(legajo?: string) {
  return useSWR<SysacadAvance>(legajo ? `/api/sysacadws/cursado/materias/cantidadesporanio/${legajo}` : null, jsonOk, SWR_CFG);
}
export function useExamenes(legajo?: string) {
  return useSWR<SysacadExamenes>(legajo ? `/api/sysacadws/examenes/${legajo}` : null, jsonOk, SWR_CFG);
}
export function usePlan(idEspecialidad?: string, plan?: string) {
  return useSWR<SysacadPlan>(idEspecialidad && plan ? `/api/sysacadws/plan/${idEspecialidad}/${plan}` : null, jsonOk, SWR_CFG);
}

// Datos por scraping (sesión ASP). Si está vencida (401) devolvemos vacío en vez
// de error, para degradar suave (la sección muestra su estado vacío).
async function scrapeData<T>(url: string): Promise<{ data: T[]; alumno?: string }> {
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 401) return { data: [] };
  if (!r.ok) {
    const e = new Error("fetch failed") as WithStatus;
    e.status = r.status;
    throw e;
  }
  const j = await r.json();
  return { data: (j.data ?? []) as T[], alumno: j.alumno };
}
export function useEstado() {
  return useSWR("sysacad-estado", () => scrapeData<MateriaEstado>("/api/sysacad/estado"), SWR_CFG);
}
export function useCorrelatividades() {
  return useSWR("sysacad-correlatividades", () => scrapeData<MateriaCorrelativa>("/api/sysacad/correlatividades"), SWR_CFG);
}
