import { ClipboardCheck } from "lucide-react";
import { sumField, type SysacadAvance, type SysacadExamen } from "@/lib/sysacadws";
import type { MateriaEstado } from "@/lib/sysacadTypes";
import CollapsibleCard from "./CollapsibleCard";
import InscripcionesChart from "./charts/InscripcionesChart";
import ExamenesChart from "./charts/ExamenesChart";
import ProgresoChart from "./charts/ProgresoChart";

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex-1 rounded-2xl bg-[var(--surface2)] px-3 py-3 text-center">
      <p className="text-[24px] font-bold leading-none" style={{ color: tone }}>{value}</p>
      <p className="text-[12px] text-[var(--secondary)] mt-1">{label}</p>
    </div>
  );
}

function ChartBlock({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--separator)] p-3">
      <p className="text-[13px] font-semibold text-[var(--fg)] px-1">{title}</p>
      {hint && <p className="text-[11px] text-[var(--secondary)] px-1 mb-1">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Avance académico: indicadores + gráficos (inscripciones, exámenes, progreso). */
export default function AvanceWidget({
  avance,
  examenes,
  estado,
  estadoLoading,
}: {
  avance: SysacadAvance;
  examenes: SysacadExamen[];
  estado: MateriaEstado[];
  estadoLoading?: boolean;
}) {
  const cant = avance.Cantidades ?? [];
  const aprobadasAvance = sumField(cant, "AprobacionesDirectas") + sumField(cant, "PromocionesTP");
  const regulares = sumField(cant, "Regulares");
  const total = sumField(cant, "Total");

  // Progreso sobre el estado académico (todas las materias de la carrera).
  const totalMaterias = estado.length;
  const aprobadasEstado = estado.filter((m) => /aprob/i.test(m.estado) || !!m.nota).length;

  return (
    <CollapsibleCard
      title="Avance académico"
      icon={ClipboardCheck}
      iconColor="#34c759"
      right={<span className="text-[12px] text-[var(--secondary)]">{aprobadasAvance} aprobadas</span>}
    >
      <div className="flex gap-2.5 mb-4">
        <Stat label="Aprobadas" value={aprobadasAvance} tone="#34c759" />
        <Stat label="Regulares" value={regulares} tone="#ff9500" />
        <Stat label="Total" value={total} tone="var(--fg)" />
      </div>

      <div className="space-y-3">
        <ChartBlock title="Cursado por ciclo lectivo" hint="Materias inscriptas por año">
          <InscripcionesChart cantidades={cant} />
        </ChartBlock>
        <ChartBlock title="Exámenes por ciclo lectivo" hint="Finales por año">
          <ExamenesChart examenes={examenes} />
        </ChartBlock>
        <ChartBlock title="Progreso académico" hint="Materias aprobadas del estado académico">
          {estadoLoading ? (
            <div className="flex items-center gap-4 py-1">
              <div className="shrink-0 h-[132px] w-[132px] rounded-full bg-[var(--surface2)] animate-pulse" />
              <div className="flex-1 space-y-3">
                <div className="h-4 w-24 rounded-full bg-[var(--surface2)] animate-pulse" />
                <div className="h-4 w-20 rounded-full bg-[var(--surface2)] animate-pulse" />
                <div className="h-4 w-16 rounded-full bg-[var(--surface2)] animate-pulse" />
              </div>
            </div>
          ) : (
            <ProgresoChart aprobadas={aprobadasEstado} total={totalMaterias} />
          )}
        </ChartBlock>
      </div>
    </CollapsibleCard>
  );
}
