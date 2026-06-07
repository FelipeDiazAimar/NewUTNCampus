"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTooltip, useChartColors } from "./common";

function Row({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-[var(--secondary)]">
        {tone && <span className="w-2 h-2 rounded-full" style={{ background: tone }} />}
        {label}
      </span>
      <span className="font-bold tabular-nums" style={{ color: tone ?? "var(--fg)" }}>{value}</span>
    </div>
  );
}

/** Dona: % de materias aprobadas vs pendientes del estado académico. */
export default function ProgresoChart({ aprobadas, total }: { aprobadas: number; total: number }) {
  const colors = useChartColors();
  if (total === 0) {
    return (
      <p className="text-[13px] text-[var(--secondary)] text-center py-6">
        Disponible al iniciar sesión en Sysacad (estado académico).
      </p>
    );
  }
  const pendientes = Math.max(0, total - aprobadas);
  const pct = Math.round((aprobadas / total) * 100);
  const data = [
    { name: "Aprobadas", value: aprobadas, color: "#34c759" },
    { name: "Pendientes", value: pendientes, color: colors.grid },
  ];

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: 132, height: 132 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={46} outerRadius={62} startAngle={90} endAngle={-270} stroke="none" paddingAngle={2}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[26px] font-bold text-[var(--fg)] leading-none">{pct}%</span>
          <span className="text-[11px] text-[var(--secondary)] mt-0.5">completado</span>
        </div>
      </div>
      <div className="flex-1 space-y-2 text-[14px]">
        <Row label="Materias" value={total} />
        <Row label="Aprobadas" value={aprobadas} tone="#34c759" />
        <Row label="Pendientes" value={pendientes} tone="#ff9500" />
      </div>
    </div>
  );
}
