/**
 * Parsea los horarios del cursado (scraping de notas) a una grilla semanal para
 * la app de Horarios. Cada materia trae un string como
 * "Miércoles 21:30-23:45" o "Jueves 20:15-23:15, Viernes 18:00-21:00".
 */
import type { MateriaCursando } from "@/lib/sysacadTypes";

export interface ClassSlot {
  day: number; // 0=domingo … 6=sábado
  startMin: number;
  endMin: number;
  start: string; // "HH:MM"
  end: string;
  materia: string;
  aula: string; // "Aula 0 · Presencial"
  faltas: number;
}

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(DIACRITICS, "").trim();
}

const DAY_MAP: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

export const DAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Limpia "Aula: 0 MODALIDAD PRESENCIAL" → "Aula 0 · Presencial". */
function parseAula(modalidad: string): string {
  const aula = modalidad.match(/Aula:\s*(\S+)/i)?.[1];
  const mod = /virtual/i.test(modalidad) ? "Virtual" : /presencial/i.test(modalidad) ? "Presencial" : "";
  return [aula ? `Aula ${aula}` : "", mod].filter(Boolean).join(" · ");
}

/** Construye todos los slots de clase a partir del cursado. */
export function buildSchedule(notas: MateriaCursando[]): ClassSlot[] {
  const slots: ClassSlot[] = [];
  if (!Array.isArray(notas)) return slots;
  for (const m of notas) {
    const aula = parseAula(m.modalidad);
    for (const part of (m.horario ?? "").split(",")) {
      const mt = part
        .trim()
        .match(/([A-Za-zÁÉÍÓÚáéíóúü]+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (!mt) continue;
      const day = DAY_MAP[norm(mt[1])];
      if (day === undefined) continue;
      const startMin = Number(mt[2]) * 60 + Number(mt[3]);
      const endMin = Number(mt[4]) * 60 + Number(mt[5]);
      slots.push({
        day,
        startMin,
        endMin,
        start: `${mt[2].padStart(2, "0")}:${mt[3]}`,
        end: `${mt[4].padStart(2, "0")}:${mt[5]}`,
        materia: m.materia,
        aula,
        faltas: m.inasistenciasTotal || 0,
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
