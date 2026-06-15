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
  loading,
}: {
  icon: typeof Award;
  value: string;
  sub?: string;
  label: string;
  tone: string;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-[var(--separator)] bg-[var(--surface)] px-3.5 py-3">
        <div className="h-4 w-4 rounded-md animate-pulse bg-[var(--surface2)]" />
        <div className="mt-2 h-7 w-14 rounded-lg animate-pulse bg-[var(--surface2)]" />
        <div className="mt-1.5 h-3 w-16 rounded animate-pulse bg-[var(--surface2)]" />
      </div>
    );
  }
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
  loading,
  estado,
  examenes,
  plan,
  avance,
  cursado,
}: {
  loading?: boolean;
  estado: MateriaEstado[];
  examenes: SysacadExamen[];
  plan: SysacadPlan | null;
  avance: SysacadAvance | null;
  cursado: SysacadCursado | null;
}) {
  const { promedio, egreso, cursando } = useMemo(() => {
    if (!plan || !avance || !cursado) return { promedio: { sinAplazos: null, conAplazos: null, aprobados: 0, aplazos: 0, ausentes: 0 }, egreso: { aprobadas: 0, totalMaterias: 0, pct: 0 }, cursando: 0 };
    return {
      promedio: computePromedio(estado, examenes),
      egreso: computeEgreso(estado, plan, avance),
      cursando: (cursado.Comisiones ?? []).length,
    };
  }, [estado, examenes, plan, avance, cursado]);

  const prom = promedio.sinAplazos;
  const promTone = prom == null ? "var(--fg)" : notaTone(prom);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(0,122,255,0.1),transparent_60%)]" />
      <div className="relative grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile loading={loading} icon={Award} value={prom != null ? prom.toFixed(2) : "—"} label="Promedio" tone={promTone} />
        <Tile loading={loading} icon={BookCheck} value={String(egreso.aprobadas)} sub={`/ ${egreso.totalMaterias}`} label="Aprobadas" tone="#34c759" />
        <Tile loading={loading} icon={GraduationCap} value={`${egreso.pct}%`} label="Avance" tone="#af52de" />
        <Tile loading={loading} icon={Layers} value={String(cursando)} label="Cursando" tone="#007aff" />
      </div>

      {!loading && (promedio.aprobados > 0 || promedio.aplazos > 0) && (
        <p className="relative mt-3 px-1 text-[12px] text-[var(--secondary)]">
          Promedio con aplazos{" "}
          <span className="font-semibold text-[var(--fg)]">
            {promedio.conAplazos != null ? promedio.conAplazos.toFixed(2) : "—"}
          </span>
          {" · "}
          {promedio.aprobados} aprobados · {promedio.aplazos} aplazos · {promedio.ausentes} ausentes
        </p>
      )}
      {loading && <div className="relative mt-3 h-3 w-3/4 rounded animate-pulse bg-[var(--surface2)]" />}
    </section>
  );
}
