"use client";

import useSWR from "swr";
import type {
  SysacadAvance,
  SysacadCursado,
  SysacadCorrelatividades,
  SysacadEstadoAcademico,
  SysacadExamenes,
  SysacadPlan,
  SysacadMateriasParaCursado,
  SysacadMateriaParaCursado,
  SysacadComisionDisponible,
  SysacadComisionesDisponibles,
  SysacadInscripcionResult,
} from "@/lib/sysacadws";
import type { MateriaEstado, MateriaCorrelativa } from "@/lib/sysacadTypes";
import { mapCorrelatividades, mapEstadoAcademico } from "@/lib/sysacadMappers";
import { reportClientError } from "@/lib/clientErrorReporter";

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
export function useMateriasParaCursado(legajo?: string) {
  return useSWR<SysacadMateriasParaCursado>(
    legajo ? `/api/sysacadws/cursado/materiasparacursado/${legajo}` : null,
    jsonOk,
    SWR_CFG
  );
}

// Estado académico y correlatividades: ahora desde el web service (antes scraping).
// Si la sesión venció (401) degradamos suave devolviendo lista vacía.
export function useEstado(legajo?: string) {
  return useSWR<{ data: MateriaEstado[] }>(
    legajo ? `/api/sysacadws/cursado/estadoacademico/${legajo}` : null,
    async (url: string) => {
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 401) return { data: [] };
      if (!r.ok) { const e = new Error("fetch failed") as WithStatus; e.status = r.status; throw e; }
      const j = (await r.json()) as SysacadEstadoAcademico;
      return { data: mapEstadoAcademico(j.resultadosAcademicos ?? []) };
    },
    SWR_CFG
  );
}
/** Inasistencias con fecha (para el heatmap). Devuelve un Map fecha → materias. */
type InasItem = { Fecha?: string; NombreMateria?: string; Materia?: string; CodMateria?: string };
type InasResp = {
  Inasistencias?: InasItem[];
  data?: InasItem[];
  Materias?: { NombreMateria?: string; Materia?: string; Inasistencias?: InasItem[] }[];
};
export function useInasistenciasMap(legajo?: string, anio?: number) {
  return useSWR<Map<string, string[]>>(
    legajo && anio ? `/api/sysacadws/cursado/inasistencias/${legajo}/${anio}` : null,
    async (url: string) => {
      const out = new Map<string, string[]>();
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return out;
      const j = (await r.json()) as InasResp;

      const add = (fecha: string | undefined, materia: string) => {
        const m = (fecha ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return;
        const key = `${m[1]}-${m[2]}-${m[3]}`;
        const arr = out.get(key) ?? [];
        if (materia && !arr.includes(materia)) arr.push(materia);
        out.set(key, arr);
      };

      if (Array.isArray(j.Materias)) {
        for (const mat of j.Materias) {
          const nombre = (mat.NombreMateria || mat.Materia || "").trim();
          for (const it of mat.Inasistencias ?? []) add(it.Fecha, nombre);
        }
      } else {
        for (const it of j.Inasistencias ?? j.data ?? []) {
          add(it.Fecha, (it.NombreMateria || it.Materia || it.CodMateria || "").trim());
        }
      }
      return out;
    },
    SWR_CFG
  );
}

export function useCorrelatividades(legajo?: string) {
  return useSWR<{ data: MateriaCorrelativa[] }>(
    legajo ? `/api/sysacadws/cursado/correlatividadcursado/${legajo}` : null,
    async (url: string) => {
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 401) return { data: [] };
      if (!r.ok) { const e = new Error("fetch failed") as WithStatus; e.status = r.status; throw e; }
      const j = (await r.json()) as SysacadCorrelatividades;
      return { data: mapCorrelatividades(j.correlatividades ?? []) };
    },
    SWR_CFG
  );
}

// ─── Inscripción a cursado (mutaciones, no son hooks SWR) ─────────────────────

export type ComisionesResult =
  | { ok: true; comisiones: SysacadComisionDisponible[] }
  | { ok: false; motivo: string };

/** Consulta las comisiones ofertadas para una materia candidata. */
export async function fetchComisiones(
  legajo: string,
  especialidad: string,
  plan: string,
  idMateria: string
): Promise<ComisionesResult> {
  try {
    const r = await fetch(
      `/api/sysacadws/cursado/comisiones/${legajo}/${especialidad}/${plan}/${idMateria}`,
      { cache: "no-store" }
    );
    if (r.status === 404) {
      const j = await r.json().catch(() => ({ Message: "" }));
      const motivo = String(j.Message ?? "").replace(/^\d+\s*-\s*/, "").trim();
      return { ok: false, motivo: motivo || "No cumplís las correlatividades para esta materia." };
    }
    if (!r.ok) {
      reportClientError("warning", `Consultar comisiones (${idMateria}): status ${r.status}`);
      return { ok: false, motivo: "No se pudo consultar las comisiones disponibles." };
    }
    const j = (await r.json()) as SysacadComisionesDisponibles;
    return { ok: true, comisiones: j.Comisiones ?? [] };
  } catch (e) {
    reportClientError("error", `Consultar comisiones (${idMateria}): fallo de red`, {
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    return { ok: false, motivo: "No se pudo conectar. Revisá tu conexión." };
  }
}

export type AccionResult = { ok: true } | { ok: false; motivo: string };

/**
 * Arma la URL de inscribir/desinscribir. El trío Especialidad/Plan/IdMateria
 * de la materia se repite dos veces (ver spec: los campos *Homogenea vienen
 * en "0" cuando Comision === "0" y no sirven para esta llamada).
 */
function inscripcionUrl(
  accion: "inscribir" | "desinscribir",
  legajo: string,
  materia: SysacadMateriaParaCursado,
  comision: string
): string {
  const { Especialidad, Plan, IdMateria } = materia;
  return `/api/sysacadws/cursado/${accion}/${legajo}/${Especialidad}/${Plan}/${IdMateria}/${Especialidad}/${Plan}/${IdMateria}/${comision}`;
}

export async function postInscribir(
  legajo: string,
  materia: SysacadMateriaParaCursado,
  comision: string
): Promise<{ ok: true; data: SysacadInscripcionResult } | { ok: false; motivo: string }> {
  try {
    const r = await fetch(inscripcionUrl("inscribir", legajo, materia, comision), { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      reportClientError("warning", `Inscripción a cursado (${materia.IdMateria}): status ${r.status}`);
      return { ok: false, motivo: j.error ?? j.Message ?? "No se pudo completar la inscripción." };
    }
    // Sysacad real responde "Estado": "2 - " en éxito (no "OK" — eso es solo
    // la convención del mock de invitado). "2" es el único código de éxito
    // observado en la captura real; cualquier otro prefijo se trata como falla.
    if (typeof j.Estado === "string" && j.Estado.trim() !== "" && !j.Estado.trim().startsWith("2")) {
      reportClientError("warning", `Inscripción a cursado (${materia.IdMateria}): Estado=${j.Estado}`);
      return { ok: false, motivo: j.Message ?? j.error ?? "No se pudo completar la inscripción." };
    }
    return { ok: true, data: j as SysacadInscripcionResult };
  } catch (e) {
    reportClientError("error", `Inscripción a cursado (${materia.IdMateria}): fallo de red`, {
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    return { ok: false, motivo: "No se pudo conectar. Revisá tu conexión." };
  }
}

export async function postDesinscribir(
  legajo: string,
  materia: SysacadMateriaParaCursado
): Promise<AccionResult> {
  try {
    const r = await fetch(inscripcionUrl("desinscribir", legajo, materia, materia.Comision), { method: "POST" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      reportClientError("warning", `Baja de cursado (${materia.IdMateria}): status ${r.status}`);
      return { ok: false, motivo: j.error ?? j.Message ?? "No se pudo completar la baja." };
    }
    return { ok: true };
  } catch (e) {
    reportClientError("error", `Baja de cursado (${materia.IdMateria}): fallo de red`, {
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    return { ok: false, motivo: "No se pudo conectar. Revisá tu conexión." };
  }
}
