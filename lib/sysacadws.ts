/**
 * Cliente del web service de Sysacad (sysacadws) — JSON nativo, autenticado por
 * header `Authorization: Basic base64(Legajo:DNI)`.  Convive con el Sysacad por
 * scraping (lib/sysacad.ts): el WS cubre perfil/cursado/avance/notas/plan y el
 * scraping queda para correlatividades y cambio de contraseña.
 */

export const SYSACADWS_BASE = "https://sistemas.frsfco.utn.edu.ar/sysacadws";

// ─── Tipos de las respuestas del WS ───────────────────────────────────────────

/** /cursado/datospersonales/{legajo} */
export interface SysacadDatosPersonales {
  Estado: string;
  Legajo: string;
  NombreAlumno: string;
  Gruposanguineo: string;
  NombreGrupoSanguineo: string;
  NumeroDocumento: string;
  Cuil: string;
  Mail: string;
  TelefonoFijo: string;
  Celular: string;
  IdEspecialidad: string;
  NombreEspecialidad: string;
  Plan: string;
  EstadoAlumno: string;
}

/** Una materia que el alumno está cursando (con inasistencias). */
export interface SysacadComision {
  AñoAcademico: string;
  CodMateria: string;
  NombreMateria: string;
  Horarios: string;
  CantidadInasistencias: string;
}

/** /cursado/coninasistencia/{legajo} */
export interface SysacadCursado {
  Estado: string;
  Comisiones: SysacadComision[];
}

/** Resumen de materias por año académico. */
export interface SysacadCantidad {
  AnioAcademico: string;
  Total: string;
  Regulares: string;
  PromocionesTP: string;
  AprobacionesDirectas: string;
}

/** /cursado/materias/cantidadesporanio/{legajo} */
export interface SysacadAvance {
  Estado: string;
  Cantidades: SysacadCantidad[];
}

/** Un examen rendido. */
export interface SysacadExamen {
  FechaExamen: string; // YYYY-MM-DD
  NombreMateria: string;
  Nota: string; // "ocho", "diez", "Ausen.", a veces un dígito
}

/** /examenes/{legajo} */
export interface SysacadExamenes {
  Estado: string;
  Examenes: SysacadExamen[];
}

/** Una materia del plan de estudio. */
export interface SysacadPlanMateria {
  IdMateria: string;
  NombreMateria: string;
  Año: string;
  Cuatrimestre: string;
  SeCursa: string;
  SeRinde: string;
}

/** /plan/{idEspecialidad}/{plan} */
export interface SysacadPlan {
  Estado: string;
  Materias: SysacadPlanMateria[];
}

/** Datos del alumno que guardamos en la cookie legible para gatear la UI. */
export interface SysacadWsUser {
  legajo: string;
  nombre: string;
  especialidad: string;
  estado: string;
  idEspecialidad: string;
  plan: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NUM_WORDS: Record<string, number> = {
  cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};

export interface NotaInfo {
  value: number | null; // 0–10, o null si ausente/no numérica
  ausente: boolean;
  label: string; // texto a mostrar ("8", "10", "Ausente")
  aprobada: boolean; // value >= 6
}

/** Normaliza la nota de Sysacad (palabra o dígito) a número + estado. */
export function parseNota(nota: string): NotaInfo {
  const raw = (nota ?? "").trim();
  const lower = raw.toLowerCase();
  if (/ausen/.test(lower)) return { value: null, ausente: true, label: "Ausente", aprobada: false };
  const digit = raw.match(/^\d{1,2}/)?.[0];
  if (digit) {
    const v = Number(digit);
    return { value: v, ausente: false, label: String(v), aprobada: v >= 6 };
  }
  const word = NUM_WORDS[lower];
  if (word !== undefined) return { value: word, ausente: false, label: String(word), aprobada: word >= 6 };
  return { value: null, ausente: false, label: raw || "—", aprobada: false };
}

/** Suma segura de campos string-numéricos del avance académico. */
export function sumField(cantidades: SysacadCantidad[], field: keyof SysacadCantidad): number {
  return cantidades.reduce((acc, c) => acc + (Number(c[field]) || 0), 0);
}
