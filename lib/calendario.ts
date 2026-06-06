/**
 * Datos del Calendario Académico 2026 — UTN FR San Francisco.
 * Por ahora solo está cargado el de Ingenierías (el de Tecnicaturas/Licenciaturas
 * es distinto y no tenemos sus fechas todavía).
 */

export type DayType =
  | "exam_final"
  | "inicio_cuatrimestre"
  | "fin_cuatrimestre"
  | "receso"
  | "feriado"
  | "semana17"
  | "inicio_seminario"
  | "fin_seminario"
  | "sin_actividad"
  | "mesas_especiales"
  | "tarea_inicio"
  | "tarea_fin";

export type CalendarPlan = "ingenierias" | "tecnicaturas";

export interface LegendItem {
  type: DayType;
  label: string;
  color: string;
}

/** Leyenda + colores (estilo iOS). */
export const LEGEND: LegendItem[] = [
  { type: "exam_final", label: "Exámenes finales", color: "#34C759" },
  { type: "inicio_cuatrimestre", label: "Inicio cuatrimestre", color: "#FFD60A" },
  { type: "fin_cuatrimestre", label: "Fin cuatrimestre", color: "#FF9F0A" },
  { type: "receso", label: "Receso académico", color: "#5AC8FA" },
  { type: "mesas_especiales", label: "Mesas especiales", color: "#30B0C7" },
  { type: "semana17", label: "Semana 17 · Recuperatorios", color: "#FF9F0A" },
  { type: "feriado", label: "Feriado", color: "#8E8E93" },
  { type: "inicio_seminario", label: "Inicio seminario", color: "#5856D6" },
  { type: "fin_seminario", label: "Fin seminario", color: "#5856D6" },
  { type: "sin_actividad", label: "Sin actividad académica", color: "#636366" },
  { type: "tarea_inicio", label: "Inicio de tarea", color: "#0A84FF" },
  { type: "tarea_fin", label: "Cierre de tarea", color: "#FF3B30" },
];

export const LEGEND_BY_TYPE: Record<DayType, LegendItem> = Object.fromEntries(
  LEGEND.map((l) => [l.type, l])
) as Record<DayType, LegendItem>;

/** Fechas ISO entre start y end (inclusive), excluyendo sábados y domingos.
 *  El receso académico se pinta solo en días de semana (ej: julio 06–10 y 13–17). */
function weekdayRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  while (d <= e) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      out.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      );
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Fechas del calendario de Ingenierías 2026 (YYYY-MM-DD). */
const INGENIERIAS: Record<Exclude<DayType, "tarea_inicio" | "tarea_fin">, string[]> = {
  exam_final: [
    "2026-02-09", "2026-02-10", "2026-02-19", "2026-02-20",
    "2026-03-03", "2026-03-04",
    "2026-04-08", "2026-04-28",
    "2026-07-23", "2026-07-24", "2026-07-29", "2026-07-30",
    "2026-09-04",
    "2026-12-03", "2026-12-04", "2026-12-14", "2026-12-15", "2026-12-21", "2026-12-22",
    "2027-02-11", "2027-02-12", "2027-02-18", "2027-02-19",
    "2027-03-02", "2027-03-03",
  ],
  inicio_cuatrimestre: ["2026-03-16", "2026-08-03", "2027-03-15"],
  fin_cuatrimestre: ["2026-07-03", "2026-11-20"],
  receso: [
    ...weekdayRange("2026-01-02", "2026-02-07"),
    ...weekdayRange("2026-07-05", "2026-07-17"),
    ...weekdayRange("2027-01-02", "2027-02-06"),
  ],
  feriado: [
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-03-23", "2026-03-24",
    "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-25", "2026-06-15", "2026-06-20",
    "2026-07-09", "2026-07-10", "2026-08-17", "2026-08-19",
    "2026-10-04", "2026-10-12", "2026-11-23",
    "2026-12-07", "2026-12-08", "2026-12-24", "2026-12-25", "2026-12-31",
    "2027-01-01", "2027-02-08", "2027-02-09",
    "2027-03-24", "2027-03-25", "2027-03-26",
  ],
  semana17: ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"],
  inicio_seminario: ["2026-01-28", "2026-07-25", "2027-01-27"],
  fin_seminario: ["2026-02-27", "2026-11-07", "2027-02-26"],
  sin_actividad: ["2026-05-02", "2026-09-21"],
  mesas_especiales: [
    "2026-05-18", "2026-05-19", "2026-05-20",
    "2026-08-20", "2026-08-21",
    "2026-10-20", "2026-10-21", "2026-10-22",
  ],
};

/** Fechas del calendario de Licenciatura y Tecnicatura (TUP) 2026. */
const LICENCIATURA: Record<Exclude<DayType, "tarea_inicio" | "tarea_fin">, string[]> = {
  exam_final: [
    "2026-02-09", "2026-02-10", "2026-02-19", "2026-02-20",
    "2026-03-03", "2026-03-04",
    "2026-04-08", "2026-04-28",
    "2026-07-23", "2026-07-24", "2026-07-29", "2026-07-30",
    "2026-09-04",
    "2026-12-03", "2026-12-04", "2026-12-14", "2026-12-15", "2026-12-21", "2026-12-22",
    "2027-02-11", "2027-02-12", "2027-02-18", "2027-02-19",
    "2027-03-02", "2027-03-03",
  ],
  inicio_cuatrimestre: ["2026-03-09", "2026-08-03", "2027-03-08"],
  fin_cuatrimestre: ["2026-06-26", "2026-11-20"],
  receso: [
    ...weekdayRange("2026-01-02", "2026-02-07"),
    ...weekdayRange("2026-07-05", "2026-07-17"),
    ...weekdayRange("2027-01-02", "2027-02-07"),
  ],
  feriado: [
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-03-23", "2026-03-24",
    "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-25", "2026-06-15", "2026-06-20",
    "2026-07-09", "2026-07-10", "2026-08-17", "2026-08-19",
    "2026-10-04", "2026-10-12", "2026-11-23",
    "2026-12-07", "2026-12-08", "2026-12-24", "2026-12-25", "2026-12-31",
    "2027-01-01", "2027-02-08", "2027-02-09",
    "2027-03-24", "2027-03-25", "2027-03-26",
  ],
  semana17: [
    "2026-06-29", "2026-06-30",
    "2026-07-01", "2026-07-02", "2026-07-03",
    "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27",
  ],
  inicio_seminario: ["2026-01-28", "2026-07-25", "2027-01-27"],
  fin_seminario: ["2026-02-27", "2026-11-07", "2027-02-26"],
  sin_actividad: ["2026-05-02", "2026-09-21"],
  mesas_especiales: [
    "2026-05-18", "2026-05-19", "2026-05-20",
    "2026-08-20", "2026-08-21",
    "2026-10-20", "2026-10-21", "2026-10-22",
  ],
};

/** date (YYYY-MM-DD) → tipos académicos, para el plan dado. */
export function buildAcademicMap(plan: CalendarPlan): Map<string, DayType[]> {
  const map = new Map<string, DayType[]>();
  const source = plan === "tecnicaturas" ? LICENCIATURA : INGENIERIAS;
  for (const [type, dates] of Object.entries(source) as [DayType, string[]][]) {
    for (const d of dates) {
      const arr = map.get(d) ?? [];
      arr.push(type);
      map.set(d, arr);
    }
  }
  return map;
}

/** Meses a renderizar: Ene 2026 → Mar 2027 (15 meses). */
export const CALENDAR_MONTHS: { year: number; month: number }[] = (() => {
  const out: { year: number; month: number }[] = [];
  for (let i = 0; i < 15; i++) {
    const m = (0 + i) % 12;
    const y = 2026 + Math.floor((0 + i) / 12);
    out.push({ year: y, month: m });
  }
  return out;
})();

export const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Bloques de "PERÍODO LECTIVO 2026" (abril–diciembre 2026). */
export function isPeriodoLectivo(year: number, month: number): boolean {
  return year === 2026 && month >= 3 && month <= 11;
}

/** Helper: YYYY-MM-DD local. */
export function isoDate(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
