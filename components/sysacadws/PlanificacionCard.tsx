"use client";

import { useMemo } from "react";
import { CircleDot, KeyRound, Lock, Sparkles } from "lucide-react";
import type { SysacadCursado } from "@/lib/sysacadws";
import type { MateriaEstado } from "@/lib/sysacadTypes";
import { useCorrelatividades } from "@/lib/sysacadHooks";
import { computeDesbloqueadoras, computeDisponibles } from "@/lib/sysacadStats";
import CollapsibleCard from "./CollapsibleCard";

/** Planificación del próximo cuatrimestre: qué podés inscribir y qué conviene priorizar. */
export default function PlanificacionCard({
  estado,
  cursado,
  legajo,
}: {
  estado: MateriaEstado[];
  cursado: SysacadCursado;
  legajo?: string;
}) {
  const { data: corr, isLoading } = useCorrelatividades(legajo);
  const correlativCount = corr?.data?.length ?? 0;

  const { disponibles, desbloqueadoras } = useMemo(() => {
    const correlativ = corr?.data ?? [];
    return {
      disponibles: computeDisponibles(correlativ, estado, cursado),
      desbloqueadoras: computeDesbloqueadoras(correlativ),
    };
  }, [corr, estado, cursado]);

  const totalInscribibles = disponibles.inscribibles.length;

  if (isLoading && correlativCount === 0) {
    return (
      <CollapsibleCard title="Planificación" icon={Sparkles} iconColor="#ff9500">
        <p className="py-4 text-center text-[14px] text-[var(--secondary)]">Cargando…</p>
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard
      title="Planificación"
      icon={Sparkles}
      iconColor="#ff9500"
      right={totalInscribibles > 0 ? <span className="rounded-full bg-[#34c7591a] px-2.5 py-1 text-[12px] font-semibold text-[#34c759]">{totalInscribibles} para anotar</span> : undefined}
    >
      <div className="space-y-5">
        {/* Disponibles para inscribir */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
            <CircleDot className="h-3.5 w-3.5 text-[#34c759]" />
            Podés inscribirte
          </p>
          {disponibles.inscribibles.length === 0 ? (
            <p className="px-1 text-[13px] text-[var(--secondary)]">
              No hay materias disponibles para inscribir por ahora.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[var(--separator)] divide-y divide-[var(--separator)]">
              {disponibles.inscribibles.map((m, i) => (
                <div key={`${m.materia}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#34c7591a]">
                    <CircleDot className="h-4 w-4 text-[#34c759]" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--fg)]">{m.materia}</span>
                  {m.nivel && <span className="shrink-0 text-[11px] text-[var(--secondary)]">Año {m.nivel}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Disponibles al regularizar lo que cursás */}
        {disponibles.alRegularizar.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
              <KeyRound className="h-3.5 w-3.5 text-[#007aff]" />
              Al regularizar lo que cursás
            </p>
            <div className="overflow-hidden rounded-2xl border border-[var(--separator)] divide-y divide-[var(--separator)]">
              {disponibles.alRegularizar.map((m, i) => (
                <div key={`${m.materia}-${i}`} className="px-4 py-2.5">
                  <p className="text-[14px] font-medium text-[var(--fg)]">{m.materia}</p>
                  <p className="mt-0.5 text-[12px] text-[var(--secondary)]">
                    Necesitás regularizar: {m.faltan.join(", ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Materias desbloqueadoras */}
        {desbloqueadoras.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
              <Lock className="h-3.5 w-3.5 text-[#af52de]" />
              Conviene aprobar primero
            </p>
            <div className="space-y-2">
              {desbloqueadoras.slice(0, 5).map((d, i) => (
                <div key={`${d.materia}-${i}`} className="rounded-2xl border border-[var(--separator)] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--fg)]">{d.materia}</span>
                    <span className="shrink-0 rounded-full bg-[#af52de1a] px-2.5 py-1 text-[11px] font-semibold text-[#af52de]">
                      Desbloquea {d.count}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-[var(--secondary)]">
                    {d.desbloquea.slice(0, 4).join(" · ")}
                    {d.desbloquea.length > 4 ? ` +${d.desbloquea.length - 4}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}
