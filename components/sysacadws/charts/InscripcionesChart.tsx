"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SysacadCantidad } from "@/lib/sysacadws";
import { ChartTooltip, useChartColors } from "./common";

/** Barras: materias inscriptas/cursadas por ciclo lectivo. */
export default function InscripcionesChart({ cantidades }: { cantidades: SysacadCantidad[] }) {
  const colors = useChartColors();
  const data = [...cantidades]
    .sort((a, b) => a.AnioAcademico.localeCompare(b.AnioAcademico))
    .map((c) => ({ anio: c.AnioAcademico, inscripciones: Number(c.Total) || 0 }));

  if (data.length === 0) {
    return <p className="text-[13px] text-[var(--secondary)] text-center py-6">Sin datos de cursado.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
        <XAxis dataKey="anio" tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
        <Tooltip cursor={{ fill: colors.grid, opacity: 0.4 }} content={<ChartTooltip />} />
        <Bar dataKey="inscripciones" name="Inscripciones" fill="#007aff" radius={[8, 8, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}
