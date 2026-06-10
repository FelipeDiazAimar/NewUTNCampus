/**
 * Formas de datos de Sysacad que consume la UI. Antes vivían en lib/sysacad.ts
 * (junto al scraping, ya eliminado); hoy las llena el web service vía
 * lib/sysacadMappers.ts. Son solo tipos — sin runtime.
 */

/** Una materia en el estado académico (aprobada / en curso / pendiente). */
export interface MateriaEstado {
  nivel: string;   // "0".."5" (año / nivel)
  materia: string;
  estado: string;  // raw: "Aprobada con 8 (5 hs.) Tomo: 190 Folio: 247" | "Cursa en 4K …" | ""
  nota: string;    // nota numérica si la materia está aprobada ("8"), si no ""
  detalle: string; // estado legible: "Cantidad de horas: 5hs Tomo: 190 Folio: 247" o el estado tal cual
  plan: string;    // "Plan 2023"
}

/** Una materia en Correlatividades (puede o no cursarse). */
export interface MateriaCorrelativa {
  nivel: string;
  materia: string;
  puedeCursar: boolean; // true si el motivo dice "Puede cursar"
  motivo: string;       // "Puede cursar" | "No regularizó X (Ord. 1878)\n…"
  plan: string;
}

/** Una materia que el alumno está cursando (grilla de horarios). */
export interface MateriaCursando {
  nivel: string;
  materia: string;
  materiaUrl: string;
  comision: string;
  modalidad: string;   // "Aula: 0 MODALIDAD PRESENCIAL"
  horario: string;     // "Miércoles 21:30-23:45"
  claveCampus: string;
  inasistencias: string;
  inasistenciasTotal: number;
  inasistenciasJustificadas: number;
  notasParciales: string;
}
