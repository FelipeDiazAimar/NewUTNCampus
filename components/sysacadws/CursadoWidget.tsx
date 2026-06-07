import { CalendarClock } from "lucide-react";
import type { SysacadCursado } from "@/lib/sysacadws";
import CollapsibleCard from "./CollapsibleCard";

/** Color del badge de inasistencias según la cantidad. */
function faltasTone(n: number): { bg: string; fg: string } {
  if (n >= 3) return { bg: "#ff3b301a", fg: "#ff3b30" };
  if (n >= 1) return { bg: "#ff95001a", fg: "#ff9500" };
  return { bg: "#34c7591a", fg: "#34c759" };
}

/** Cursado actual: una tarjeta por materia con horarios e inasistencias. */
export default function CursadoWidget({ cursado }: { cursado: SysacadCursado }) {
  const comisiones = cursado.Comisiones ?? [];

  return (
    <CollapsibleCard
      title="Cursado actual"
      icon={CalendarClock}
      iconColor="#007aff"
      right={<span className="text-[12px] text-[var(--secondary)]">{comisiones.length} materias</span>}
    >
      {comisiones.length === 0 ? (
        <p className="text-[14px] text-[var(--secondary)] text-center py-4">No hay materias en curso.</p>
      ) : (
        <div className="rounded-2xl border border-[var(--separator)] overflow-hidden divide-y divide-[var(--separator)]">
          {comisiones.map((c, i) => {
            const n = Number(c.CantidadInasistencias) || 0;
            const tone = faltasTone(n);
            return (
              <div key={`${c.CodMateria}-${i}`} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-medium text-[var(--fg)] leading-snug">{c.NombreMateria}</p>
                  <p className="text-[12px] text-[var(--secondary)] mt-0.5">{c.Horarios}</p>
                </div>
                <span
                  className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap"
                  style={{ backgroundColor: tone.bg, color: tone.fg }}
                >
                  {n} {n === 1 ? "falta" : "faltas"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleCard>
  );
}
