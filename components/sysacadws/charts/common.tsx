"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Resuelve las variables CSS a color real para los ejes/leyendas de recharts
 * (los atributos SVG `fill` no resuelven var()). Se recalcula al cambiar el tema.
 */
export function useChartColors() {
  const { resolvedTheme } = useTheme();
  const [c, setC] = useState({ fg: "#1c1c1e", secondary: "#8e8e93", grid: "rgba(120,120,128,0.2)" });
  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    const get = (v: string, fb: string) => s.getPropertyValue(v).trim() || fb;
    setC({
      fg: get("--fg", "#1c1c1e"),
      secondary: get("--secondary", "#8e8e93"),
      grid: get("--separator", "rgba(120,120,128,0.2)"),
    });
  }, [resolvedTheme]);
  return c;
}

/** Tooltip estilo iOS (usa variables CSS → modo oscuro perfecto). */
export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 shadow-lg">
      {label != null && <p className="text-[12px] font-semibold text-[var(--fg)] mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5 text-[12px] text-[var(--secondary)]">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-semibold text-[var(--fg)]">{p.value}</span>
        </p>
      ))}
    </div>
  );
}
