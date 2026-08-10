"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import SegmentedControl from "@/components/campus/SegmentedControl";
import { ChartTooltip, useChartColors } from "@/components/sysacadws/charts/common";
import ErrorEventsModal from "./ErrorEventsModal";

type Granularity = "day" | "month";
type Severity = "critical" | "error" | "warning";

export interface DateRange {
  from: string;
  to: string;
}

interface SeverityPoint {
  period: string;
  critical: number;
  error: number;
  warning: number;
}

interface ErrorStatsResponse {
  series: SeverityPoint[];
  todayCounts: { critical: number; error: number; warning: number };
}

const SEVERITY_COLORS: Record<Severity, string> = { critical: "#ff3b30", error: "#ff9500", warning: "#ffcc00" };
const SEVERITY_LABELS: Record<Severity, string> = { critical: "Crítico", error: "Error", warning: "Warning" };
const SEVERITY_ORDER: Severity[] = ["critical", "error", "warning"];

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(granularity: Granularity): DateRange {
  const to = new Date();
  const from = new Date(to);
  if (granularity === "day") from.setDate(from.getDate() - 29);
  else from.setMonth(from.getMonth() - 11);
  return { from: toDateInput(from), to: toDateInput(to) };
}

/** Sección "Errores" de /admin/dashboard: cantidad de errores por criticidad + gráfico + filtro. */
export default function ErrorStatsSection() {
  const colors = useChartColors();
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [range, setRange] = useState<DateRange>(() => defaultRange("day"));
  const [rangeTouched, setRangeTouched] = useState(false);
  const [data, setData] = useState<ErrorStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalKey, setModalKey] = useState(0);

  function changeGranularity(next: string) {
    const g = next as Granularity;
    setGranularity(g);
    if (!rangeTouched) setRange(defaultRange(g));
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    const params = new URLSearchParams({ granularity, from: range.from, to: range.to });
    fetch(`/api/admin/error-stats?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData({ series: [], todayCounts: { critical: 0, error: 0, warning: 0 } });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [granularity, range.from, range.to]);

  const series = data?.series ?? [];
  const hasData = series.some((s) => s.critical + s.error + s.warning > 0);
  const today = data?.todayCounts ?? { critical: 0, error: 0, warning: 0 };

  return (
    <section className="mb-7">
      <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
        Errores
      </p>
      <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm p-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[rgba(255,59,48,0.12)] text-[#ff3b30]">
            <AlertTriangle className="h-[22px] w-[22px]" />
          </span>
          <div className="flex-1 flex flex-wrap gap-x-5 gap-y-1 min-w-[160px]">
            {SEVERITY_ORDER.map((sev) => (
              <div key={sev}>
                <p
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: SEVERITY_COLORS[sev] }}
                >
                  {SEVERITY_LABELS[sev]} hoy
                </p>
                <p className="text-[20px] font-bold tracking-tight text-[var(--fg)] leading-none tabular-nums">
                  {data ? today[sev] : "—"}
                </p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setModalKey((k) => k + 1);
              setModalOpen(true);
            }}
            className="rounded-full bg-[var(--surface2)] px-3.5 py-1.5 text-[13px] font-semibold text-[#007aff] active:opacity-70"
          >
            Ver más
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <SegmentedControl
            ariaLabel="Granularidad"
            value={granularity}
            onChange={changeGranularity}
            options={[
              { value: "day", label: "Diario" },
              { value: "month", label: "Mensual" },
            ]}
          />
          <div className="flex items-center gap-1.5 text-[13px]">
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => {
                setRangeTouched(true);
                setRange((r) => ({ ...r, from: e.target.value }));
              }}
              className="rounded-lg border border-[var(--separator)] bg-[var(--surface2)] px-2 py-1.5 text-[var(--fg)]"
            />
            <span className="text-[var(--secondary)]">a</span>
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => {
                setRangeTouched(true);
                setRange((r) => ({ ...r, to: e.target.value }));
              }}
              className="rounded-lg border border-[var(--separator)] bg-[var(--surface2)] px-2 py-1.5 text-[var(--fg)]"
            />
          </div>
        </div>

        {loading ? (
          <p className="text-[13px] text-[var(--secondary)] text-center py-10">Cargando…</p>
        ) : !hasData ? (
          <p className="text-[13px] text-[var(--secondary)] text-center py-10">Sin datos en este rango.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
              <XAxis dataKey="period" tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: colors.secondary, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="critical" name={SEVERITY_LABELS.critical} stackId="sev" fill={SEVERITY_COLORS.critical} />
              <Bar dataKey="error" name={SEVERITY_LABELS.error} stackId="sev" fill={SEVERITY_COLORS.error} />
              <Bar dataKey="warning" name={SEVERITY_LABELS.warning} stackId="sev" fill={SEVERITY_COLORS.warning} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <ErrorEventsModal key={modalKey} open={modalOpen} onClose={() => setModalOpen(false)} from={range.from} to={range.to} />
    </section>
  );
}
