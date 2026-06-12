"use client";

import { useMemo } from "react";
import { Rocket } from "lucide-react";
import type { SysacadAvance, SysacadPlan } from "@/lib/sysacadws";
import type { MateriaEstado } from "@/lib/sysacadTypes";
import { computeEgreso } from "@/lib/sysacadStats";
import CollapsibleCard from "./CollapsibleCard";

function fmt(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
}

/** Estimación de egreso a partir del ritmo de aprobación reciente (promos + finales). */
export default function EgresoCard({
  estado,
  plan,
  avance,
}: {
  estado: MateriaEstado[];
  plan: SysacadPlan;
  avance: SysacadAvance;
}) {
  const e = useMemo(() => computeEgreso(estado, plan, avance), [estado, plan, avance]);

  return (
    <CollapsibleCard
      title="Estimación de egreso"
      icon={Rocket}
      iconColor="#ff9500"
      right={
        e.anioEgreso != null ? (
          <span className="rounded-full bg-[#ff95001a] px-2.5 py-1 text-[12px] font-semibold text-[#ff9500]">
            ~{e.anioEgreso}
          </span>
        ) : undefined
      }
    >
      {/* Barra de avance */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[13px] text-[var(--secondary)]">Avance de carrera</span>
          <span className="text-[15px] font-bold text-[var(--fg)]">{e.pct}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface2)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#34c759] to-[#30d158] transition-[width] duration-700"
            style={{ width: `${e.pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--secondary)]">
          {e.aprobadas} de {e.totalMaterias} materias · <span className="font-medium text-[var(--fg)]">{e.restantes} restantes</span>
        </p>
      </div>

      {e.aniosRestantes != null ? (
        <div className="grid grid-cols-3 gap-2.5">
          <Stat value={fmt(e.ritmoAnual)} label="Materias / año" tone="#007aff" />
          <Stat value={String(e.cuatrimestresRestantes)} label="Cuatrimestres" tone="#af52de" />
          <Stat value={`~${e.anioEgreso}`} label="Egreso aprox." tone="#34c759" />
        </div>
      ) : (
        <p className="rounded-2xl bg-[var(--surface2)] px-4 py-3 text-[13px] text-[var(--secondary)]">
          Necesitás algunas materias aprobadas con fecha de final para estimar tu ritmo de avance.
        </p>
      )}

      <p className="mt-3 px-1 text-[11px] leading-relaxed text-[var(--secondary)]">
        Estimación basada en tu ritmo de aprobación de los últimos años. Es orientativa.
      </p>
    </CollapsibleCard>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-[var(--surface2)] px-3 py-3 text-center">
      <p className="text-[22px] font-bold leading-none" style={{ color: tone }}>{value}</p>
      <p className="mt-1 text-[11px] text-[var(--secondary)]">{label}</p>
    </div>
  );
}
