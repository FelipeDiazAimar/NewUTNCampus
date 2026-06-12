"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SysacadExamen } from "@/lib/sysacadws";
import { computePromedioPorAnio } from "@/lib/sysacadStats";
import { ChartTooltip, useChartColors } from "./common";

/** Evolución del promedio de finales año a año. */
export default function PromedioAnualChart({ examenes }: { examenes: SysacadExamen[] }) {
  const colors = useChartColors();
  const data = computePromedioPorAnio(examenes).map((d) => ({
    anio: d.anio,
    Promedio: Number(d.promedio.toFixed(2)),
  }));

  if (data.length === 0) {
    return <p className="py-6 text-center text-[13px] text-[var(--secondary)]">Sin datos para calcular el promedio anual.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="promFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#007aff" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#007aff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
        <XAxis dataKey="anio" tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
        <Tooltip content={<ChartTooltip />} />
        <Area type="monotone" dataKey="Promedio" stroke="#007aff" strokeWidth={2.5} fill="url(#promFill)" dot={{ r: 3, fill: "#007aff" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
