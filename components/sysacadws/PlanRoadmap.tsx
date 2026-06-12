"use client";

import { useMemo, useState } from "react";
import { Check, Map as MapIcon } from "lucide-react";
import type { SysacadCursado, SysacadPlan } from "@/lib/sysacadws";
import type { MateriaEstado } from "@/lib/sysacadTypes";
import { useCorrelatividades } from "@/lib/sysacadHooks";
import {
  computePlanMap,
  STATUS_META,
  type MateriaStatus,
  type PlanMateriaNode,
} from "@/lib/sysacadStats";
import CollapsibleCard from "./CollapsibleCard";

function cuatriShort(c: string): string {
  const x = (c ?? "").trim().toLowerCase();
  if (x.startsWith("anual")) return "An";
  if (x.startsWith("2")) return "2C";
  if (x.startsWith("1")) return "1C";
  return "";
}

function Chip({ m, dim }: { m: PlanMateriaNode; dim: boolean }) {
  const meta = STATUS_META[m.status];
  const badge = cuatriShort(m.cuatrimestre);
  return (
    <div
      className="flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-all duration-300"
      style={{
        borderColor: dim ? "var(--separator)" : `${meta.color}55`,
        backgroundColor: dim ? "transparent" : meta.bg,
        opacity: dim ? 0.32 : 1,
      }}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
      >
        {m.status === "aprobada" ? (
          <Check className="h-3 w-3" strokeWidth={3} />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-tight text-[var(--fg)]">
        {m.nombre}
      </span>
      {m.status === "aprobada" && m.nota ? (
        <span className="shrink-0 text-[13px] font-bold tabular-nums" style={{ color: meta.color }}>
          {m.nota}
        </span>
      ) : badge ? (
        <span className="shrink-0 rounded-md bg-[var(--surface2)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--secondary)]">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

/** Mapa del plan de estudio: una columna por año con sus materias coloreadas por estado. */
export default function PlanRoadmap({
  estado,
  cursado,
  plan,
  legajo,
}: {
  estado: MateriaEstado[];
  cursado: SysacadCursado;
  plan: SysacadPlan;
  legajo?: string;
}) {
  const { data: corr } = useCorrelatividades(legajo);
  const [filtro, setFiltro] = useState<MateriaStatus | null>(null);

  const columnas = useMemo(
    () => computePlanMap(plan, estado, cursado, corr?.data ?? []),
    [plan, estado, cursado, corr]
  );

  const conteo = useMemo(() => {
    const c: Record<MateriaStatus, number> = {
      aprobada: 0, cursando: 0, disponible: 0, bloqueada: 0, pendiente: 0,
    };
    for (const col of columnas) for (const m of col.materias) c[m.status]++;
    return c;
  }, [columnas]);

  const totalMaterias = columnas.reduce((a, c) => a + c.total, 0);

  if (totalMaterias === 0) {
    return (
      <CollapsibleCard title="Mapa del plan" icon={MapIcon} iconColor="#007aff">
        <p className="py-4 text-center text-[14px] text-[var(--secondary)]">
          Disponible al cargar el plan de estudio.
        </p>
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard
      title="Mapa del plan"
      icon={MapIcon}
      iconColor="#007aff"
      right={<span className="text-[12px] text-[var(--secondary)]">{totalMaterias} materias</span>}
    >
      {/* Leyenda interactiva */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(Object.keys(STATUS_META) as MateriaStatus[])
          .filter((s) => conteo[s] > 0)
          .map((s) => {
            const meta = STATUS_META[s];
            const active = filtro === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFiltro(active ? null : s)}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-all active:scale-95"
                style={{
                  borderColor: active ? meta.color : "var(--separator)",
                  backgroundColor: active ? meta.bg : "transparent",
                  color: active ? meta.color : "var(--secondary)",
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                {meta.label}
                <span className="tabular-nums opacity-70">{conteo[s]}</span>
              </button>
            );
          })}
      </div>

      {/* Columnas por año (scroll horizontal con snap) */}
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {columnas.map((col) => {
          const pct = col.total > 0 ? Math.round((col.aprobadas / col.total) * 100) : 0;
          return (
            <div
              key={col.anio}
              className="w-[200px] shrink-0 snap-start rounded-2xl border border-[var(--separator)] bg-[var(--surface2)] p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-bold text-[var(--fg)]">Año {col.anio}</span>
                <span className="text-[11px] font-semibold text-[var(--secondary)]">
                  {col.aprobadas}/{col.total}
                </span>
              </div>
              <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--separator)]">
                <div
                  className="h-full rounded-full bg-[#34c759] transition-[width] duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="space-y-1.5">
                {col.materias.map((m) => (
                  <Chip key={m.id} m={m} dim={filtro != null && m.status !== filtro} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}
