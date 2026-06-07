/** Evento de horario personalizado (gimnasio, trabajo, grupo de estudio, etc.). */
export interface CustomScheduleEvent {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  day_of_week: number; // 0=domingo … 6=sábado
  start_time: string; // "HH:MM"
  end_time: string;
  color_hex: string;
  created_at?: string;
}

/** Paleta de colores para el selector del modal. */
export const EVENT_COLORS = [
  "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#30b0c7", "#007aff", "#af52de", "#8e8e93",
];

export function hhmmToMin(s: string): number {
  const [h, m] = (s || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
