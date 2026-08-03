/**
 * Parsea los horarios del cursado (scraping de notas) a una grilla semanal para
 * la app de Horarios. Cada materia trae un string como
 * "Miércoles 21:30-23:45" o "Jueves 20:15-23:15, Viernes 18:00-21:00".
 */
import type { MateriaCursando } from "@/lib/sysacadTypes";
import { normalizeAulaLabel, normalizeMateriaName, type OfficialSlot } from "@/lib/officialSchedule";

export interface ClassSlot {
  day: number; // 0=domingo … 6=sábado
  startMin: number;
  endMin: number;
  start: string; // "HH:MM"
  end: string;
  materia: string;
  aula: string; // "Aula 0 · Presencial"
  faltas: number;
  /** Aula que figura en la grilla oficial de la carrera, si no coincide con la de Sysacad. */
  aulaMismatch?: string;
}

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
export function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(DIACRITICS, "").trim();
}

export const DAY_MAP: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

export const DAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** "Aula: 0 MODALIDAD PRESENCIAL" → { aulaNum: "0", modalidad: "Presencial" }. */
function parseModalidad(modalidad: string): { aulaNum: string; modalidad: string } {
  const aulaNum = modalidad.match(/Aula:\s*(\S+)/i)?.[1] ?? "";
  const mod = /virtual/i.test(modalidad) ? "Virtual" : /presencial/i.test(modalidad) ? "Presencial" : "";
  return { aulaNum, modalidad: mod };
}

/** Busca en la grilla oficial la comisión que corresponde a esta materia/día/horario. */
function matchOfficial(materia: string, day: number, startMin: number, official: OfficialSlot[]): OfficialSlot | null {
  const materiaNorm = normalizeMateriaName(materia);
  // Tolerancia de 20' para no perder el match por pequeños desfasajes entre
  // lo que scrapea Sysacad y lo que se tipeó a mano en la grilla oficial.
  const enDiaYHora = official.filter((o) => o.day === day && Math.abs(o.startMin - startMin) <= 20);

  const exacto = enDiaYHora.find((o) => o.materiaNorm === materiaNorm);
  if (exacto) return exacto;

  // Sysacad trunca el nombre de la materia a ~40 caracteres ("Administración
  // de Sistemas de Informació"): si el de la oficial empieza igual, es la
  // misma. Se exige un mínimo de largo para no matchear nombres cortos al azar.
  if (materiaNorm.length < 15) return null;
  return (
    enDiaYHora.find((o) => o.materiaNorm.startsWith(materiaNorm) || materiaNorm.startsWith(o.materiaNorm)) ?? null
  );
}

/** Construye todos los slots de clase a partir del cursado, completando/corroborando el
 *  aula con la grilla oficial de la carrera cuando está disponible. */
export function buildSchedule(notas: MateriaCursando[], official: OfficialSlot[] = []): ClassSlot[] {
  const slots: ClassSlot[] = [];
  if (!Array.isArray(notas)) return slots;
  for (const m of notas) {
    const { aulaNum, modalidad } = parseModalidad(m.modalidad);
    for (const part of (m.horario ?? "").split(",")) {
      const mt = part
        .trim()
        .match(/([A-Za-zÁÉÍÓÚáéíóúü]+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (!mt) continue;
      const day = DAY_MAP[norm(mt[1])];
      if (day === undefined) continue;
      const startMin = Number(mt[2]) * 60 + Number(mt[3]);
      const endMin = Number(mt[4]) * 60 + Number(mt[5]);

      const oficial = matchOfficial(m.materia, day, startMin, official);
      // Sysacad manda "Aula: 0" como placeholder de "todavía sin asignar", no
      // como un aula real — se trata igual que "sin dato" para poder completarla.
      const aulaConocida = aulaNum && aulaNum !== "0";
      let finalAulaNum = aulaNum;
      let aulaMismatch: string | undefined;
      if (oficial) {
        if (!aulaConocida) {
          finalAulaNum = oficial.aula; // Sysacad no traía aula (o traía "0"): se completa con la oficial.
        } else if (normalizeAulaLabel(aulaNum) !== normalizeAulaLabel(oficial.aula)) {
          aulaMismatch = oficial.aula; // Sysacad trae otra: se marca la discrepancia.
        }
      }
      if (process.env.NODE_ENV !== "production") {
        // TEMPORAL: para diagnosticar el match materia/día/horario contra la grilla oficial.
        console.log(
          "[horarios-oficiales] materia:", JSON.stringify(m.materia),
          "día:", day, "desde:", startMin,
          "aulaSysacad:", JSON.stringify(aulaNum),
          "match oficial:", oficial ? { aula: oficial.aula, materia: oficial.materia } : null,
          "aulaFinal:", finalAulaNum
        );
      }

      slots.push({
        day,
        startMin,
        endMin,
        start: `${mt[2].padStart(2, "0")}:${mt[3]}`,
        end: `${mt[4].padStart(2, "0")}:${mt[5]}`,
        materia: m.materia,
        aula: [finalAulaNum ? `Aula ${finalAulaNum}` : "", modalidad].filter(Boolean).join(" · "),
        faltas: m.inasistenciasTotal || 0,
        aulaMismatch,
      });
    }
  }
  return slots;
}

/** Paleta iOS — un color estable por materia. */
const PALETTE = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#30b0c7", "#007aff", "#af52de", "#5856d6"];

export function colorMap(slots: ClassSlot[]): Map<string, string> {
  const names = [...new Set(slots.map((s) => s.materia))];
  return new Map(names.map((n, i) => [n, PALETTE[i % PALETTE.length]]));
}

/** MM:SS (o H:MM:SS si supera la hora) a partir de segundos restantes. */
export function fmtRemaining(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
