"use client";

import { useMemo, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import type { SysacadPlan } from "@/lib/sysacadws";

/** Plan de estudio: total de materias + listado colapsable agrupado por año. */
export default function PlanWidget({ plan, planNombre }: { plan: SysacadPlan; planNombre: string }) {
  const [open, setOpen] = useState(false);
  const materias = plan.Materias ?? [];

  const porAnio = useMemo(() => {
    const list = plan.Materias ?? [];
    const map = new Map<string, typeof list>();
    for (const m of list) {
      const a = m.Año || "—";
      if (!map.has(a)) map.set(a, []);
      map.get(a)!.push(m);
    }
    return [...map.entries()].sort((x, y) => x[0].localeCompare(y[0], "es", { numeric: true }));
  }, [plan.Materias]);

  return (
    <section className="rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] backdrop-blur-md shadow-sm p-5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-left">
        <BookOpen className="w-[18px] h-[18px] text-[#ff9500]" />
        <span className="flex-1 text-[15px] font-semibold text-[var(--fg)]">
          Plan de estudio {planNombre}
        </span>
        <span className="text-[12px] text-[var(--secondary)]">{materias.length} materias</span>
        <ChevronDown className={`w-4 h-4 text-[var(--secondary)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {porAnio.map(([anio, list]) => (
            <div key={anio}>
              <p className="px-1 mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                Año {anio}
              </p>
              <div className="rounded-2xl border border-[var(--separator)] overflow-hidden divide-y divide-[var(--separator)]">
                {list.map((m) => (
                  <div key={m.IdMateria} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="text-[14px] text-[var(--fg)] leading-snug min-w-0">{m.NombreMateria}</span>
                    <span className="text-[12px] text-[var(--secondary)] shrink-0">{m.Cuatrimestre}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
