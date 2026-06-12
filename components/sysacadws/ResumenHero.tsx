"use client";

import { useMemo } from "react";
import { Award, BookCheck, GraduationCap, Layers } from "lucide-react";
import type { SysacadAvance, SysacadCursado, SysacadExamen, SysacadPlan } from "@/lib/sysacadws";
import type { MateriaEstado } from "@/lib/sysacadTypes";
import { computeEgreso, computePromedio, notaTone } from "@/lib/sysacadStats";

function Tile({
  icon: Icon,
  value,
  sub,
  label,
  tone,
}: {
  icon: typeof Award;
  value: string;
  sub?: string;
  label: string;
  tone: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--separator)] bg-[var(--surface)] px-3.5 py-3">
      <span
        className="absolute -right-3 -top-3 h-12 w-12 rounded-full opacity-[0.12] blur-md"
        style={{ background: tone }}
      />
      <Icon className="h-4 w-4" style={{ color: tone }} />
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-[26px] font-bold leading-none tracking-tight" style={{ color: tone }}>
          {value}
        </span>
        {sub && <span className="text-[12px] font-medium text-[var(--secondary)]">{sub}</span>}
      </div>
      <p className="mt-1 text-[12px] font-medium text-[var(--secondary)]">{label}</p>
    </div>
  );
}

/** Resumen ejecutivo de la carrera: promedio, aprobadas, % avance y cursando. */
export default function ResumenHero({
  estado,
  examenes,
  plan,
  avance,
  cursado,
}: {
  estado: MateriaEstado[];
  examenes: SysacadExamen[];
  plan: SysacadPlan;
  avance: SysacadAvance;
  cursado: SysacadCursado;
}) {
  const { promedio, egreso, cursando } = useMemo(
    () => ({
      promedio: computePromedio(estado, examenes),
      egreso: computeEgreso(estado, plan, avance),
      cursando: (cursado.Comisiones ?? []).length,
    }),
    [estado, examenes, plan, avance, cursado]
  );

  const prom = promedio.sinAplazos;
  const promTone = prom == null ? "var(--fg)" : notaTone(prom);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(0,122,255,0.1),transparent_60%)]" />
      <div className="relative grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile
          icon={Award}
          value={prom != null ? prom.toFixed(2) : "—"}
          label="Promedio"
          tone={promTone}
        />
        <Tile
          icon={BookCheck}
          value={String(egreso.aprobadas)}
          sub={`/ ${egreso.totalMaterias}`}
          label="Aprobadas"
          tone="#34c759"
        />
        <Tile
          icon={GraduationCap}
          value={`${egreso.pct}%`}
          label="Avance"
          tone="#af52de"
        />
        <Tile
          icon={Layers}
          value={String(cursando)}
          label="Cursando"
          tone="#007aff"
        />
      </div>

      {(promedio.aprobados > 0 || promedio.aplazos > 0) && (
        <p className="relative mt-3 px-1 text-[12px] text-[var(--secondary)]">
          Promedio con aplazos{" "}
          <span className="font-semibold text-[var(--fg)]">
            {promedio.conAplazos != null ? promedio.conAplazos.toFixed(2) : "—"}
          </span>
          {" · "}
          {promedio.aprobados} aprobados · {promedio.aplazos} aplazos · {promedio.ausentes} ausentes
        </p>
      )}
    </section>
  );
}
