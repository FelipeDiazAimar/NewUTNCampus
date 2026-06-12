/**
 * Cálculos de asistencia para /sysacad. Cruza los horarios de cursado con el
 * calendario académico (lib/calendario) para estimar cuántas clases tiene cada
 * materia, aplicar la regla del 70% (no quedar libre) y armar un heatmap real
 * de asistencias/inasistencias usando las fechas que devuelve el web service.
 */
import { buildAcademicMap, type CalendarPlan, type DayType } from "./calendario";
import { norm } from "./sysacadStats";
import type { SysacadComision, SysacadCursado, SysacadPlan } from "./sysacadws";

// ─── Plan académico (calendario) según especialidad ───────────────────────────

export function calendarPlanFor(especialidad: string): CalendarPlan {
  return /tecnicatura|licenciatura|\btup\b/i.test(especialidad ?? "") ? "tecnicaturas" : "ingenierias";
}

// ─── Días de la semana ────────────────────────────────────────────────────────

const DIA_TO_DOW: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3,
  jueves: 4, viernes: 5, sabado: 6, sábado: 6,
};

/** "Miércoles 21:30-23:45, Jueves 18:00-21:00" → [3, 4] (días de la semana). */
export function parseDiasHorario(horarios: string): number[] {
  const out = new Set<number>();
  const re = /\b(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(horarios ?? ""))) {
    const dow = DIA_TO_DOW[norm(m[1])];
    if (dow != null) out.add(dow);
  }
  return [...out];
}

// ─── Cuatrimestre de cada materia ─────────────────────────────────────────────

export type Cuatri = "1c" | "2c" | "anual";

export function cuatriFromPlan(cuatrimestre: string): Cuatri {
  const x = (cuatrimestre ?? "").trim().toLowerCase();
  if (x.startsWith("anual") || x === "a") return "anual";
  if (x.startsWith("2")) return "2c";
  return "1c";
}

/** Rangos del ciclo lectivo 2026 (del calendario académico). */
const RANGOS: Record<CalendarPlan, Record<Cuatri, [string, string]>> = {
  ingenierias: {
    "1c": ["2026-03-16", "2026-07-03"],
    "2c": ["2026-08-03", "2026-11-20"],
    anual: ["2026-03-16", "2026-11-20"],
  },
  tecnicaturas: {
    "1c": ["2026-03-09", "2026-06-26"],
    "2c": ["2026-08-03", "2026-11-20"],
    anual: ["2026-03-09", "2026-11-20"],
  },
};

const SIN_CLASE: ReadonlySet<DayType> = new Set<DayType>(["feriado", "receso", "sin_actividad"]);

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Fechas de clase de una materia: días del cuatrimestre que caen en sus días de
 *  cursada, excluyendo feriados / receso / días sin actividad. */
function fechasDeClase(dias: number[], cuatri: Cuatri, planType: CalendarPlan, academic: Map<string, DayType[]>): string[] {
  if (dias.length === 0) return [];
  const [start, end] = RANGOS[planType][cuatri];
  const diasSet = new Set(dias);
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  while (d <= e) {
    if (diasSet.has(d.getDay())) {
      const key = iso(d);
      const tipos = academic.get(key) ?? [];
      if (!tipos.some((t) => SIN_CLASE.has(t))) out.push(key);
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// ─── 10 · Riesgo de inasistencias (regla del 70%) ─────────────────────────────

export type RiesgoNivel = "ok" | "warn" | "danger" | "libre";

export interface MateriaRiesgo {
  materia: string;
  cuatri: Cuatri;
  diasPorSemana: number;
  totalClases: number;
  transcurridas: number;
  faltas: number;
  justificadas: number;
  maxFaltas: number;       // 30% del total (llegar al 70% de asistencia)
  faltasRestantes: number; // cuántas veces más puede faltar
  pctAsistencia: number;   // sobre clases transcurridas
  nivel: RiesgoNivel;
}

function cuatriDeMateria(nombre: string, planMap: Map<string, string>): Cuatri {
  return cuatriFromPlan(planMap.get(norm(nombre)) ?? "");
}

export function computeRiesgoInasistencias(
  cursado: SysacadCursado,
  plan: SysacadPlan,
  especialidad: string,
  hoy: Date = new Date()
): MateriaRiesgo[] {
  const planType = calendarPlanFor(especialidad);
  const academic = buildAcademicMap(planType);
  const planCuatri = new Map((plan.Materias ?? []).map((m) => [norm(m.NombreMateria), m.Cuatrimestre]));
  const hoyIso = iso(hoy);

  return (cursado.Comisiones ?? []).map((c: SysacadComision): MateriaRiesgo => {
    const dias = parseDiasHorario(c.Horarios ?? "");
    const cuatri = cuatriDeMateria(c.NombreMateria, planCuatri);
    const fechas = fechasDeClase(dias, cuatri, planType, academic);
    const totalClases = fechas.length;
    const transcurridas = fechas.filter((f) => f <= hoyIso).length;
    const faltas = Number(c.CantidadInasistencias) || 0;
    const justificadas = Number(c.CantidadJustificadas) || 0;
    const maxFaltas = Math.floor(totalClases * 0.3);
    const faltasRestantes = maxFaltas - faltas;
    const pctAsistencia = transcurridas > 0
      ? Math.round(((transcurridas - faltas) / transcurridas) * 100)
      : 100;

    let nivel: RiesgoNivel;
    if (faltas > maxFaltas) nivel = "libre";
    else if (faltasRestantes <= 1) nivel = "danger";
    else if (faltasRestantes <= 3) nivel = "warn";
    else nivel = "ok";

    return {
      materia: c.NombreMateria,
      cuatri,
      diasPorSemana: dias.length,
      totalClases,
      transcurridas,
      faltas,
      justificadas,
      maxFaltas,
      faltasRestantes,
      pctAsistencia,
      nivel,
    };
  });
}

export const RIESGO_META: Record<RiesgoNivel, { label: string; color: string; bg: string }> = {
  ok:     { label: "En regla",   color: "#34c759", bg: "rgba(52,199,89,0.14)" },
  warn:   { label: "Atención",   color: "#ff9500", bg: "rgba(255,149,0,0.14)" },
  danger: { label: "En riesgo",  color: "#ff3b30", bg: "rgba(255,59,48,0.14)" },
  libre:  { label: "Libre",      color: "#ff3b30", bg: "rgba(255,59,48,0.2)" },
};

// ─── 15 · Heatmap de asistencias / inasistencias ──────────────────────────────

export type DiaEstado = "presente" | "ausente";

export interface DiaHeatmap {
  fecha: string;        // YYYY-MM-DD
  estado: DiaEstado;
  materias: string[];   // materias con clase ese día
  ausenteEn: string[];  // materias en las que faltó ese día
}

export interface HeatmapStats {
  dias: Map<string, DiaHeatmap>;
  presentes: number;
  ausentes: number;
  primeraFecha: string | null;
  ultimaFecha: string | null;
}

/**
 * Cruza las fechas de clase de cada materia con las fechas de inasistencia
 * reales (del WS) para clasificar cada día como presente o ausente.
 * Solo cuenta días ya transcurridos.
 */
export function computeHeatmap(
  cursado: SysacadCursado,
  plan: SysacadPlan,
  especialidad: string,
  inasistencias: Map<string, string[]>,
  hoy: Date = new Date()
): HeatmapStats {
  const planType = calendarPlanFor(especialidad);
  const academic = buildAcademicMap(planType);
  const planCuatri = new Map((plan.Materias ?? []).map((m) => [norm(m.NombreMateria), m.Cuatrimestre]));
  const hoyIso = iso(hoy);

  const dias = new Map<string, DiaHeatmap>();
  for (const c of cursado.Comisiones ?? []) {
    const diasDow = parseDiasHorario(c.Horarios ?? "");
    const cuatri = cuatriDeMateria(c.NombreMateria, planCuatri);
    for (const f of fechasDeClase(diasDow, cuatri, planType, academic)) {
      if (f > hoyIso) continue; // solo clases ya dadas
      // Check if THIS specific subject had an absence on this date.
      // inasistencias is Map<fecha, string[]> where the array holds materia names.
      const materiasAusenteHoy = inasistencias.get(f) ?? [];
      const ausenteEnEsta = materiasAusenteHoy.length > 0
        ? materiasAusenteHoy.some((m) => norm(m) === norm(c.NombreMateria))
        : inasistencias.has(f); // fallback when map has no per-materia info
      const prev = dias.get(f);
      if (prev) {
        prev.materias.push(c.NombreMateria);
        if (ausenteEnEsta) {
          prev.estado = "ausente";
          if (!prev.ausenteEn.includes(c.NombreMateria)) prev.ausenteEn.push(c.NombreMateria);
        }
      } else {
        dias.set(f, {
          fecha: f,
          estado: ausenteEnEsta ? "ausente" : "presente",
          materias: [c.NombreMateria],
          ausenteEn: ausenteEnEsta ? [c.NombreMateria] : [],
        });
      }
    }
  }

  let presentes = 0;
  let ausentes = 0;
  let primera: string | null = null;
  let ultima: string | null = null;
  for (const d of dias.values()) {
    if (d.estado === "ausente") ausentes++; else presentes++;
    if (!primera || d.fecha < primera) primera = d.fecha;
    if (!ultima || d.fecha > ultima) ultima = d.fecha;
  }

  return { dias, presentes, ausentes, primeraFecha: primera, ultimaFecha: ultima };
}
