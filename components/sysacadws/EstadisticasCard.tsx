"use client";

import { BarChart3 } from "lucide-react";
import type { SysacadExamen } from "@/lib/sysacadws";
import CollapsibleCard from "./CollapsibleCard";
import NotasHistogramChart from "./charts/NotasHistogramChart";
import PromedioAnualChart from "./charts/PromedioAnualChart";

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--separator)] p-3">
      <p className="px-1 text-[13px] font-semibold text-[var(--fg)]">{title}</p>
      {hint && <p className="px-1 text-[11px] text-[var(--secondary)]">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Estadísticas de notas: histograma de notas + evolución del promedio anual. */
export default function EstadisticasCard({ examenes }: { examenes: SysacadExamen[] }) {
  return (
    <CollapsibleCard
      title="Estadísticas de notas"
      icon={BarChart3}
      iconColor="#5856d6"
      right={<span className="text-[12px] text-[var(--secondary)]">{examenes.length} finales</span>}
    >
      <div className="space-y-3">
        <Block title="Distribución de notas" hint="Cuántas veces sacaste cada nota">
          <NotasHistogramChart examenes={examenes} />
        </Block>
        <Block title="Promedio por año" hint="Cómo evolucionó tu promedio de finales">
          <PromedioAnualChart examenes={examenes} />
        </Block>
      </div>
    </CollapsibleCard>
  );
}
