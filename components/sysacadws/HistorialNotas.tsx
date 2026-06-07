import { ListChecks } from "lucide-react";
import { parseNota, type SysacadExamenes } from "@/lib/sysacadws";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function formatFecha(iso: string): string {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

/** Historial de notas — lista agrupada estilo Ajustes de iOS. */
export default function HistorialNotas({ examenes }: { examenes: SysacadExamenes }) {
  const items = [...(examenes.Examenes ?? [])].sort((a, b) => b.FechaExamen.localeCompare(a.FechaExamen));

  return (
    <section className="rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] backdrop-blur-md shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <ListChecks className="w-[18px] h-[18px] text-[#af52de]" />
        <h2 className="text-[15px] font-semibold text-[var(--fg)]">Historial de notas</h2>
      </div>

      {items.length === 0 ? (
        <p className="text-[14px] text-[var(--secondary)] text-center py-4">Sin exámenes registrados.</p>
      ) : (
        <div className="rounded-2xl border border-[var(--separator)] overflow-hidden divide-y divide-[var(--separator)]">
          {items.map((ex, i) => {
            const nota = parseNota(ex.Nota);
            const tone = nota.ausente ? "#8e8e93" : nota.aprobada ? "#34c759" : "#ff3b30";
            return (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-[var(--fg)] leading-snug truncate">{ex.NombreMateria}</p>
                  <p className="text-[12px] text-[var(--secondary)] mt-0.5">{formatFecha(ex.FechaExamen)}</p>
                </div>
                <span className="shrink-0 text-[18px] font-bold tabular-nums" style={{ color: tone }}>
                  {nota.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
