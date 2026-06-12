/**
 * Cálculos derivados de los datos de Sysacad. Funciones puras (sin runtime de
 * React) reutilizables por los widgets nuevos de /sysacad: promedio, histograma
 * de notas, promedio por año, estimación de egreso, mapa del plan, materias
 * desbloqueadoras y materias disponibles para inscribir.
 */
import { parseNota, type SysacadAvance, type SysacadCursado, type SysacadExamen, type SysacadPlan } from "./sysacadws";
import type { MateriaCorrelativa, MateriaEstado } from "./sysacadTypes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
export function norm(s: string): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(DIACRITICS, "").trim();
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Tono iOS para una nota numérica. */
export function notaTone(n: number): string {
  if (n < 6) return "#ff3b30";
  if (n < 8) return "#ff9500";
  return "#34c759";
}

// ─── 1 · Promedio general ─────────────────────────────────────────────────────

export interface PromedioStats {
  sinAplazos: number | null; // promedio de materias aprobadas (estado académico)
  conAplazos: number | null; // promedio de todos los finales numéricos (incluye < 6)
  aprobados: number;         // exámenes con nota ≥ 6
  aplazos: number;           // exámenes con nota < 6
  ausentes: number;          // exámenes ausentes
}

export function computePromedio(estado: MateriaEstado[], examenes: SysacadExamen[]): PromedioStats {
  // "Sin aplazos": una nota por materia aprobada, tomada del estado académico.
  const notasEstado: number[] = [];
  for (const m of estado) {
    const n = Number(m.nota);
    if (m.nota && !Number.isNaN(n)) notasEstado.push(n);
  }

  // Finales: cada intento cuenta para el histograma y el promedio "con aplazos".
  const numericas: number[] = [];
  let aprobados = 0;
  let aplazos = 0;
  let ausentes = 0;
  for (const ex of examenes) {
    const p = parseNota(ex.Nota);
    if (p.ausente) { ausentes++; continue; }
    if (p.value == null) continue;
    numericas.push(p.value);
    if (p.value >= 6) aprobados++;
    else aplazos++;
  }

  // Fallback de "sin aplazos" si el estado académico no trajo notas: aprobados de finales.
  const sinAplazos = notasEstado.length > 0 ? avg(notasEstado) : avg(numericas.filter((n) => n >= 6));

  return {
    sinAplazos,
    conAplazos: avg(numericas),
    aprobados,
    aplazos,
    ausentes,
  };
}

// ─── 2 · Histograma de notas ──────────────────────────────────────────────────

export interface NotaBucket {
  nota: number;        // 1..10
  count: number;       // veces que apareció esa nota
  tone: string;
  materias: { name: string; count: number }[]; // desglose para el tooltip
}

export interface HistogramaStats {
  buckets: NotaBucket[];
  ausentes: number;
  total: number;       // total de finales numéricos
  maxCount: number;
}

export function computeHistograma(examenes: SysacadExamen[]): HistogramaStats {
  const map = new Map<number, Map<string, number>>();
  let ausentes = 0;
  let total = 0;

  for (const ex of examenes) {
    const p = parseNota(ex.Nota);
    if (p.ausente) { ausentes++; continue; }
    if (p.value == null) continue;
    total++;
    const nota = p.value;
    if (!map.has(nota)) map.set(nota, new Map());
    const mm = map.get(nota)!;
    const name = (ex.NombreMateria ?? "Materia").trim();
    mm.set(name, (mm.get(name) ?? 0) + 1);
  }

  const buckets: NotaBucket[] = [];
  let maxCount = 0;
  for (let n = 1; n <= 10; n++) {
    const mm = map.get(n);
    const count = mm ? [...mm.values()].reduce((a, b) => a + b, 0) : 0;
    maxCount = Math.max(maxCount, count);
    const materias = mm
      ? [...mm.entries()].map(([name, c]) => ({ name, count: c })).sort((a, b) => b.count - a.count)
      : [];
    buckets.push({ nota: n, count, tone: notaTone(n), materias });
  }

  return { buckets, ausentes, total, maxCount };
}

// ─── 4 · Promedio por año ─────────────────────────────────────────────────────

export interface PromedioAnio {
  anio: string;
  promedio: number;     // con aplazos (todos los finales numéricos del año)
  promedioAprob: number | null; // solo aprobados
  cantidad: number;
}

export function computePromedioPorAnio(examenes: SysacadExamen[]): PromedioAnio[] {
  const byYear = new Map<string, { todas: number[]; aprob: number[] }>();
  for (const ex of examenes) {
    const anio = (ex.FechaExamen || "").slice(0, 4);
    if (!/^\d{4}$/.test(anio)) continue;
    const p = parseNota(ex.Nota);
    if (p.value == null) continue;
    const row = byYear.get(anio) ?? { todas: [], aprob: [] };
    row.todas.push(p.value);
    if (p.value >= 6) row.aprob.push(p.value);
    byYear.set(anio, row);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([anio, v]) => ({
      anio,
      promedio: v.todas.reduce((a, b) => a + b, 0) / v.todas.length,
      promedioAprob: avg(v.aprob),
      cantidad: v.todas.length,
    }));
}

// ─── 6 · Estimación de egreso ─────────────────────────────────────────────────

export interface EgresoEstimacion {
  totalMaterias: number;
  aprobadas: number;
  restantes: number;
  pct: number;
  ritmoAnual: number;            // promedio de materias aprobadas por año reciente
  aniosRestantes: number | null;
  cuatrimestresRestantes: number | null;
  anioEgreso: number | null;
}

function esAprobada(m: MateriaEstado): boolean {
  return /aprob/i.test(m.estado) || !!m.nota;
}

export function computeEgreso(
  estado: MateriaEstado[],
  plan: SysacadPlan,
  avance: SysacadAvance
): EgresoEstimacion {
  // El total real es el del estado académico del alumno (sus materias del plan),
  // no el endpoint de plan que incluye electivas que el alumno no cursa.
  const totalMaterias = estado.length > 0 ? estado.length : (plan.Materias?.length ?? 0);
  const aprobadas = estado.filter(esAprobada).length;
  const restantes = Math.max(0, totalMaterias - aprobadas);
  const pct = totalMaterias > 0 ? Math.round((aprobadas / totalMaterias) * 100) : 0;

  // Ritmo: PromocionesTP + AprobacionesDirectas por año académico (incluye promociones
  // que no generan registro de examen). Usamos los últimos 3 años con datos.
  const porAnio = new Map<string, number>();
  for (const c of avance.Cantidades ?? []) {
    const anio = (c.AnioAcademico ?? "").trim();
    if (!/^\d{4}$/.test(anio)) continue;
    const n = (Number(c.PromocionesTP) || 0) + (Number(c.AprobacionesDirectas) || 0);
    if (n > 0) porAnio.set(anio, n);
  }

  const aniosOrden = [...porAnio.keys()].sort();
  // Skip the first chronological year: it's the "ingreso" with only ~2 subjects
  // that inflates or deflates the average pace unfairly.
  const sinIngreso = aniosOrden.length > 1 ? aniosOrden.slice(1) : aniosOrden;
  const ultimos = sinIngreso.slice(-3);
  const ritmoAnual = ultimos.length > 0
    ? ultimos.reduce((a, y) => a + (porAnio.get(y) ?? 0), 0) / ultimos.length
    : 0;

  const aniosRestantes = ritmoAnual > 0 ? restantes / ritmoAnual : null;
  const cuatrimestresRestantes = aniosRestantes != null ? Math.ceil(aniosRestantes * 2) : null;
  const anioEgreso = aniosRestantes != null ? new Date().getFullYear() + Math.ceil(aniosRestantes) : null;

  return {
    totalMaterias,
    aprobadas,
    restantes,
    pct,
    ritmoAnual,
    aniosRestantes,
    cuatrimestresRestantes,
    anioEgreso,
  };
}

// ─── 7 · Mapa del plan ────────────────────────────────────────────────────────

export type MateriaStatus = "aprobada" | "cursando" | "disponible" | "bloqueada" | "pendiente";

export interface PlanMateriaNode {
  id: string;
  nombre: string;
  anio: string;
  cuatrimestre: string;
  status: MateriaStatus;
  nota?: string;
}

export interface PlanAnioCol {
  anio: string;
  materias: PlanMateriaNode[];
  aprobadas: number;
  total: number;
}

export const STATUS_META: Record<MateriaStatus, { label: string; color: string; bg: string }> = {
  aprobada:   { label: "Aprobada",   color: "#34c759", bg: "rgba(52,199,89,0.14)" },
  cursando:   { label: "Cursando",   color: "#007aff", bg: "rgba(0,122,255,0.14)" },
  disponible: { label: "Disponible", color: "#ff9500", bg: "rgba(255,149,0,0.14)" },
  bloqueada:  { label: "Bloqueada",  color: "#ff3b30", bg: "rgba(255,59,48,0.12)" },
  pendiente:  { label: "Pendiente",  color: "#8e8e93", bg: "rgba(142,142,147,0.12)" },
};

export function computePlanMap(
  plan: SysacadPlan,
  estado: MateriaEstado[],
  cursado: SysacadCursado,
  correlativ: MateriaCorrelativa[]
): PlanAnioCol[] {
  const cuatriByName = new Map((plan.Materias ?? []).map((m) => [norm(m.NombreMateria), m.Cuatrimestre]));
  const cursandoSet = new Set((cursado.Comisiones ?? []).map((c) => norm(c.NombreMateria)));
  const correlativByName = new Map(correlativ.map((m) => [norm(m.materia), m]));

  // Columna vertebral: el estado académico (las materias reales del alumno). Si
  // no está disponible, caemos al plan de estudio completo.
  const fuente =
    estado.length > 0
      ? estado.map((m) => ({ key: norm(m.materia), nombre: m.materia, anio: m.nivel || "—", est: m as MateriaEstado | undefined }))
      : (plan.Materias ?? []).map((m) => ({ key: norm(m.NombreMateria), nombre: m.NombreMateria, anio: m.Año || "—", est: undefined as MateriaEstado | undefined }));

  const colMap = new Map<string, PlanMateriaNode[]>();

  for (const item of fuente) {
    const { key, nombre, anio, est } = item;
    const corr = correlativByName.get(key);

    let status: MateriaStatus = "pendiente";
    let nota: string | undefined;
    if (est && esAprobada(est)) {
      status = "aprobada";
      nota = est.nota || undefined;
    } else if (cursandoSet.has(key) || (est && /cursa/i.test(est.estado))) {
      status = "cursando";
    } else if (corr?.puedeCursar) {
      status = "disponible";
    } else if (corr && !corr.puedeCursar) {
      status = "bloqueada";
    }

    if (!colMap.has(anio)) colMap.set(anio, []);
    colMap.get(anio)!.push({
      id: `${anio}-${nombre}`,
      nombre,
      anio,
      cuatrimestre: cuatriByName.get(key) ?? "",
      status,
      nota,
    });
  }

  return [...colMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }))
    .map(([anio, list]) => ({
      anio,
      materias: list,
      total: list.length,
      aprobadas: list.filter((x) => x.status === "aprobada").length,
    }));
}

// ─── Parser de correlatividades (para #8 y #9) ────────────────────────────────

/** Extrae los nombres de materias que faltan de un motivo de correlatividad. */
export function parseBloqueantes(motivo: string): string[] {
  if (!motivo || /puede cursar/i.test(motivo)) return [];
  const out: string[] = [];
  for (const linea of motivo.split(/\n+/)) {
    const l = linea.trim();
    if (!l) continue;
    // "No regularizó X (Ord. 1878)" | "No aprobó X" | "Adeuda X" | "Debe regularizar X"
    const m = l.match(
      /(?:no\s+(?:regulariz[oó]|aprob[oó]|tiene\s+(?:regularizad[ao]|aprobad[ao]))|adeuda|debe\s+(?:regularizar|aprobar))\s+(.+?)\s*(?:\(.*)?$/i
    );
    const nombre = (m?.[1] ?? "").trim();
    if (nombre) out.push(nombre);
  }
  return out;
}

// ─── 8 · Materias desbloqueadoras ─────────────────────────────────────────────

export interface Desbloqueadora {
  materia: string;
  desbloquea: string[];
  count: number;
}

export function computeDesbloqueadoras(correlativ: MateriaCorrelativa[]): Desbloqueadora[] {
  const map = new Map<string, { display: string; set: Set<string> }>();
  for (const m of correlativ) {
    if (m.puedeCursar) continue;
    for (const bloq of parseBloqueantes(m.motivo)) {
      const key = norm(bloq);
      if (!map.has(key)) map.set(key, { display: bloq, set: new Set() });
      map.get(key)!.set.add(m.materia);
    }
  }
  return [...map.values()]
    .map((v) => ({ materia: v.display, desbloquea: [...v.set], count: v.set.size }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);
}

// ─── 9 · Materias disponibles para inscribir ──────────────────────────────────

export interface DisponiblesStats {
  inscribibles: { materia: string; nivel: string }[];
  alRegularizar: { materia: string; nivel: string; faltan: string[] }[];
}

export function computeDisponibles(
  correlativ: MateriaCorrelativa[],
  estado: MateriaEstado[],
  cursado: SysacadCursado
): DisponiblesStats {
  const aprobadasSet = new Set(estado.filter(esAprobada).map((m) => norm(m.materia)));
  const cursandoSet = new Set((cursado.Comisiones ?? []).map((c) => norm(c.NombreMateria)));

  const inscribibles: DisponiblesStats["inscribibles"] = [];
  const alRegularizar: DisponiblesStats["alRegularizar"] = [];

  for (const m of correlativ) {
    const key = norm(m.materia);
    if (aprobadasSet.has(key)) continue;

    if (m.puedeCursar) {
      // Ya disponible, salvo que ya la esté cursando.
      if (!cursandoSet.has(key)) inscribibles.push({ materia: m.materia, nivel: m.nivel });
      continue;
    }

    // Bloqueada: ¿sus únicos faltantes son materias que está cursando ahora?
    const faltan = parseBloqueantes(m.motivo);
    if (faltan.length > 0 && !cursandoSet.has(key)) {
      const soloCursando = faltan.every((f) => cursandoSet.has(norm(f)));
      if (soloCursando) alRegularizar.push({ materia: m.materia, nivel: m.nivel, faltan });
    }
  }

  return { inscribibles, alRegularizar };
}
