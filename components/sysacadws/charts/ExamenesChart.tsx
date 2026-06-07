"use client";

import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { parseNota, type SysacadExamen } from "@/lib/sysacadws";
import { ChartTooltip, useChartColors } from "./common";

/** Líneas: aprobados / no aprobados / ausentes por ciclo lectivo. */
export default function ExamenesChart({ examenes }: { examenes: SysacadExamen[] }) {
  const colors = useChartColors();

  const byYear = new Map<string, { aprobados: number; noAprobados: number; ausentes: number }>();
  for (const ex of examenes) {
    const anio = (ex.FechaExamen || "").slice(0, 4) || "—";
    const row = byYear.get(anio) ?? { aprobados: 0, noAprobados: 0, ausentes: 0 };
    const n = parseNota(ex.Nota);
    if (n.ausente) row.ausentes += 1;
    else if (n.aprobada) row.aprobados += 1;
    else if (n.value != null) row.noAprobados += 1;
    byYear.set(anio, row);
  }
  const data = [...byYear.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([anio, v]) => ({ anio, ...v }));

  if (data.length === 0) {
    return <p className="text-[13px] text-[var(--secondary)] text-center py-6">Sin exámenes registrados.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={210}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
        <XAxis dataKey="anio" tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12, color: colors.secondary }} iconType="circle" />
        <Line type="monotone" dataKey="aprobados" name="Aprobados" stroke="#34c759" strokeWidth={2.5} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="noAprobados" name="No aprobados" stroke="#ff3b30" strokeWidth={2.5} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="ausentes" name="Ausentes" stroke="#8e8e93" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
