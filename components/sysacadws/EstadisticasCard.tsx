"use client";

import { useState } from "react";
import { BarChart3 } from "lucide-react";
import type { SysacadComision, SysacadExamen } from "@/lib/sysacadws";
import { computeHistograma, computeHistogramaParciales } from "@/lib/sysacadStats";
import CollapsibleCard from "./CollapsibleCard";
import SegmentedControl from "@/components/campus/SegmentedControl";
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

/** Estadísticas de notas: histograma de notas (finales o parciales) + evolución del promedio anual. */
export default function EstadisticasCard({
  examenes,
  comisiones,
}: {
  examenes: SysacadExamen[];
  comisiones: SysacadComision[];
}) {
  const anioActual = new Date().getFullYear();
  const [tipoNotas, setTipoNotas] = useState<"finales" | "parciales">("finales");

  const statsFinales = computeHistograma(examenes);
  const statsParciales = computeHistogramaParciales(comisiones, anioActual);

  return (
    <CollapsibleCard
      title="Estadísticas de notas"
      icon={BarChart3}
      iconColor="#5856d6"
      right={<span className="text-[12px] text-[var(--secondary)]">{examenes.length} finales</span>}
    >
      <div className="space-y-3">
        <Block title="Distribución de notas" hint="Cuántas veces sacaste cada nota">
          <SegmentedControl
            ariaLabel="Tipo de notas"
            value={tipoNotas}
            onChange={(v) => setTipoNotas(v as "finales" | "parciales")}
            options={[
              { value: "finales", label: "Finales" },
              { value: "parciales", label: `Parciales ${anioActual}` },
            ]}
          />
          <div className="mt-2">
            {tipoNotas === "finales" ? (
              <NotasHistogramChart
                stats={statsFinales}
                emptyMessage="Sin finales numéricos registrados."
                footerLabel="finales numéricos"
              />
            ) : (
              <NotasHistogramChart
                stats={statsParciales}
                emptyMessage={`Todavía no hay parciales cargados del ciclo ${anioActual}.`}
                footerLabel={`parciales de ${anioActual}`}
              />
            )}
          </div>
        </Block>
        <Block title="Promedio por año" hint="Cómo evolucionó tu promedio de finales">
          <PromedioAnualChart examenes={examenes} />
        </Block>
      </div>
    </CollapsibleCard>
  );
}
