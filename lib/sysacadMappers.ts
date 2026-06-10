/**
 * Adaptadores del web service de Sysacad → las formas que ya consume la UI
 * (definidas para el viejo scraping en lib/sysacad.ts). Funciones puras, sin
 * dependencias de runtime, para reusarlas tanto en hooks de cliente como donde
 * haga falta. Reemplazan el scraping de estado académico, correlatividades y
 * cursado/horarios por los endpoints JSON nativos.
 */
import type { MateriaCorrelativa, MateriaCursando, MateriaEstado } from "./sysacadTypes";
import type {
  SysacadComision,
  SysacadCorrelatividad,
  SysacadResultadoAcademico,
} from "./sysacadws";

/**
 * "Aprobada con 6 (5 hs.) Tomo: 190 Folio: 108"
 *   → { nota: "6", detalle: "Cantidad de horas: 5hs Tomo: 190 Folio: 108" }
 * Cualquier otro estado se deja igual (sin nota). Mismo criterio que el scraping.
 */
function splitEstadoNota(estado: string): { nota: string; detalle: string } {
  const m = estado.match(/^Aprobada con\s+(\d+(?:[.,]\d+)?)\s*\(([\d.,]+)\s*hs\.?\)\s*(.*)$/i);
  if (!m) return { nota: "", detalle: estado };
  const [, nota, horas, resto] = m;
  return { nota, detalle: `Cantidad de horas: ${horas}hs${resto.trim() ? ` ${resto.trim()}` : ""}` };
}

/** Normaliza la respuesta del WS (array, objeto único, o vacío) a un array. */
function asArray<T>(value: T[] | T | null | undefined): T[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

/** /cursado/estadoacademico → MateriaEstado[] (Avance + Historial Académico). */
export function mapEstadoAcademico(rows: SysacadResultadoAcademico[]): MateriaEstado[] {
  return asArray(rows)
    .map((r) => {
      const { nota, detalle } = splitEstadoNota(r.EstadoAcademico ?? "");
      return {
        nivel: r.Año ?? "",
        materia: (r.Nombre ?? "").trim(),
        estado: r.EstadoAcademico ?? "",
        nota,
        detalle,
        plan: r.Plan ? `Plan ${r.Plan}` : "",
      };
    })
    .filter((m) => m.materia);
}

/** /cursado/correlatividadcursado → MateriaCorrelativa[] (acordeón Correlatividades). */
export function mapCorrelatividades(rows: SysacadCorrelatividad[]): MateriaCorrelativa[] {
  return asArray(rows)
    .map((r) => {
      const motivo = (r.CorrelatividadACumplir ?? "").replace(/\s*\|\|\s*/g, "\n").trim();
      return {
        nivel: r.Año ?? "",
        materia: (r.Nombre ?? "").trim(),
        plan: r.Plan ? `Plan ${r.Plan}` : "",
        motivo,
        puedeCursar: /puede cursar/i.test(motivo),
      };
    })
    .filter((m) => m.materia);
}

/** /cursado/coninasistencia → MateriaCursando[] (grilla de Horarios). */
export function mapCursadoToMaterias(comisiones: SysacadComision[]): MateriaCursando[] {
  // El WS a veces devuelve un objeto (no array) cuando hay una sola comisión.
  return asArray(comisiones).map((c) => ({
    nivel: c.Año ?? "",
    materia: (c.NombreMateria ?? "").trim(),
    materiaUrl: "",
    comision: c.NombreComision ?? "",
    // parseAula() de lib/horarios espera "Aula: 0 MODALIDAD PRESENCIAL".
    modalidad: c.Aula ? `Aula: ${c.Aula}` : "",
    horario: c.Horarios ?? "",
    claveCampus: c.ClaveCampusVirtual ?? "",
    inasistencias: `${c.CantidadInasistencias ?? "0"} (${c.CantidadJustificadas ?? "0"} justificadas)`,
    inasistenciasTotal: Number(c.CantidadInasistencias) || 0,
    inasistenciasJustificadas: Number(c.CantidadJustificadas) || 0,
    notasParciales: c.Parciales ?? "",
  }));
}
