"use client";

import type { AssignDate, AssignRow } from "@/app/api/assign/route";

/** Da color al value de ciertos estados de la entrega (calificación, tiempo restante). */
function valueTone(label: string, value: string): string | undefined {
  const l = label.toLowerCase();
  const v = value.toLowerCase();
  if (l.includes("calificac")) return v.includes("sin calificar") ? "#ff9500" : "#34c759";
  if (l.includes("entrega") && v.includes("todavía no")) return "#ff9500";
  if (l.includes("tiempo restante")) return v.includes("atras") || v.includes("vencid") ? "#ff3b30" : "#007aff";
  return undefined;
}

/** Lista agrupada estilo Ajustes de iOS: label a la izquierda, value a la derecha. */
function GroupedList({
  title,
  items,
  colorize = false,
}: {
  title: string;
  items: { label: string; value: string }[];
  colorize?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-5">
      <p className="px-1 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
        {title}
      </p>
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] overflow-hidden shadow-sm">
        {items.map((item, i) => {
          const tone = colorize ? valueTone(item.label, item.value) : undefined;
          return (
            <div
              key={`${item.label}-${i}`}
              className={`flex items-start justify-between gap-4 px-4 py-3 ${
                i < items.length - 1 ? "border-b border-[var(--separator)]" : ""
              }`}
            >
              <span className="text-[15px] text-[var(--fg)] shrink-0">{item.label}</span>
              <span
                className="text-[15px] text-right font-medium"
                style={{ color: tone ?? "var(--secondary)" }}
              >
                {item.value}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function AssignmentStatusList({
  dates,
  rows,
}: {
  dates: AssignDate[];
  rows: AssignRow[];
}) {
  return (
    <>
      <GroupedList title="Fechas" items={dates} />
      <GroupedList title="Estado de la entrega" items={rows} colorize />
    </>
  );
}
