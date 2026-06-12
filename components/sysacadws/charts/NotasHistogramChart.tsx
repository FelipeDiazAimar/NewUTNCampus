"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SysacadExamen } from "@/lib/sysacadws";
import { computeHistograma, type NotaBucket } from "@/lib/sysacadStats";
import { useChartColors } from "./common";

/** Tooltip con desglose: qué materias y cuántas veces se sacó esa nota. */
function HistTooltip({ active, payload }: { active?: boolean; payload?: { payload: NotaBucket }[] }) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  if (b.count === 0) return null;
  return (
    <div className="max-w-[230px] rounded-xl border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 shadow-lg">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--fg)]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: b.tone }}>
          {b.nota}
        </span>
        Nota {b.nota} · {b.count} {b.count === 1 ? "vez" : "veces"}
      </p>
      <div className="space-y-0.5">
        {b.materias.map((m) => (
          <p key={m.name} className="flex items-center justify-between gap-3 text-[11.5px] text-[var(--secondary)]">
            <span className="min-w-0 truncate">{m.name}</span>
            <span className="shrink-0 font-semibold text-[var(--fg)]">×{m.count}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

/** Histograma: cuántas veces se obtuvo cada nota (1–10), con desglose por materia. */
export default function NotasHistogramChart({ examenes }: { examenes: SysacadExamen[] }) {
  const colors = useChartColors();
  const { buckets, ausentes, total } = computeHistograma(examenes);

  if (total === 0) {
    return <p className="py-6 text-center text-[13px] text-[var(--secondary)]">Sin finales numéricos registrados.</p>;
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={buckets} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
          <XAxis dataKey="nota" tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
          <Tooltip cursor={{ fill: colors.grid, opacity: 0.4 }} content={<HistTooltip />} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={34}>
            {buckets.map((b) => (
              <Cell key={b.nota} fill={b.tone} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 px-1 text-[11px] text-[var(--secondary)]">
        {total} finales numéricos{ausentes > 0 ? ` · ${ausentes} ausente${ausentes === 1 ? "" : "s"}` : ""} · tocá una barra para ver el detalle
      </p>
    </div>
  );
}
