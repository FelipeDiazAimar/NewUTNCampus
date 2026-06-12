"use client";

import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
import {
  buildAcademicMap,
  CALENDAR_MONTHS,
  isPeriodoLectivo,
  isoDate,
  LEGEND,
  MONTH_NAMES,
  type CalendarPlan,
  type DayType,
} from "@/lib/calendario";
import type { TareaEvent } from "@/app/api/calendar/route";

const WEEK = ["D", "L", "M", "M", "J", "V", "S"];
const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const CELLS = 42;

// Tipos que se dibujan como pill/círculo (todos los eventos, incluidas las tareas).
const PILL_TYPES: DayType[] = [
  "receso", "fin_cuatrimestre", "inicio_cuatrimestre", "mesas_especiales",
  "exam_final", "semana17", "feriado", "sin_actividad",
  "inicio_seminario", "fin_seminario", "tarea_inicio", "tarea_fin",
];

// Rayado diagonal naranja para semana 17.
const STRIPE = "repeating-linear-gradient(45deg, rgba(255,159,10,0.55) 0 5px, rgba(255,159,10,0.18) 5px 10px)";

/** Estilo visual de cada tipo de evento. `text` = color del número cuando es la capa de arriba. */
type DayStyle = { bg?: string; bgImage?: string; bgSize?: string; border?: string; text: string; strike?: boolean };

const DAY_STYLE: Record<DayType, DayStyle> = {
  exam_final: { bg: "#34C759", text: "#fff" },
  inicio_cuatrimestre: { bg: "#FFD60A", text: "#1c1c1e" },
  fin_cuatrimestre: { bg: "#FF9F0A", text: "#1c1c1e" },
  receso: { bg: "#5AC8FA", text: "#1c1c1e" },
  mesas_especiales: { bg: "#30B0C7", text: "#fff" },
  semana17: { bgImage: STRIPE, text: "#1c1c1e" },
  feriado: { bg: "#8E8E93", text: "#fff", strike: true },
  inicio_seminario: { bg: "#5856D6", text: "#fff" },
  fin_seminario: { bg: "#5856D6", text: "#fff" },
  sin_actividad: { bg: "#636366", text: "#fff" },
  tarea_inicio: { bg: "#0A84FF", text: "#fff" },
  tarea_fin: { bg: "#FF3B30", text: "#fff" },
};

type Layer = { type: DayType; runLeft: boolean; runRight: boolean };

/** Fecha de hoy en formato YYYY-MM-DD (local). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Cuadrito de muestra del estilo (para leyenda, tooltip y popup). */
function Swatch({ type, size = 16 }: { type: DayType; size?: number }) {
  const s = DAY_STYLE[type];
  return (
    <span
      className="rounded-[5px] shrink-0 inline-block"
      style={{
        width: size,
        height: size,
        backgroundColor: s.bg,
        backgroundImage: s.bgImage,
        backgroundSize: s.bgSize,
        border: s.border ?? undefined,
      }}
    />
  );
}

/** Switch estilo iOS (igual al de Notificaciones). */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${checked ? "bg-[#34c759]" : "bg-[var(--surface2)]"}`}
    >
      <span
        className={`absolute left-0.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

/** Lista de Referencias = filtro con toggles. */
function LegendFilter({
  enabled,
  onToggle,
}: {
  enabled: Record<DayType, boolean>;
  onToggle: (type: DayType, v: boolean) => void;
}) {
  return (
    <ul className="flex flex-col">
      {LEGEND.map((l, i) => (
        <li
          key={l.type}
          className={`flex items-center gap-2.5 py-2 ${i < LEGEND.length - 1 ? "border-b border-[var(--separator)]" : ""}`}
        >
          <Swatch type={l.type} />
          <span className="flex-1 text-[13px] text-[var(--fg)] leading-tight">{l.label}</span>
          <Toggle checked={enabled[l.type]} onChange={(v) => onToggle(l.type, v)} />
        </li>
      ))}
    </ul>
  );
}

function DayCell({
  day,
  iso,
  layers,
  weekend,
  onEnter,
  onLeave,
  onTap,
}: {
  day: number;
  iso: string;
  layers: Layer[]; // bottom→top: más largo abajo, más corto arriba
  weekend: boolean;
  onEnter: (iso: string, el: HTMLElement) => void;
  onLeave: () => void;
  onTap: (iso: string) => void;
}) {
  const top = layers[layers.length - 1];
  // Si hay evento de fondo, el número usa el color de contraste del evento
  // (así un cierre rojo en sábado/domingo no queda rojo-sobre-rojo). Si no hay
  // evento, los fines de semana van en rojo.
  const numberColor = top ? DAY_STYLE[top.type].text : weekend ? "#FF3B30" : "var(--fg)";
  const isToday = iso === todayIso();

  return (
    <button
      type="button"
      onMouseEnter={(e) => onEnter(iso, e.currentTarget)}
      onMouseLeave={onLeave}
      onClick={() => onTap(iso)}
      className={`relative aspect-square flex items-center justify-center rounded-full text-[13px] transition-transform active:scale-90 ${isToday ? "today-ring z-20" : "hover:ring-2 hover:ring-[var(--accent)]/40"}`}
      aria-label={iso}
    >
      {layers.map((L, k) => {
        const s = DAY_STYLE[L.type];
        const inset = 3 + k * 3;
        return (
          <span
            key={k}
            aria-hidden
            className="absolute z-0"
            style={{
              top: inset,
              bottom: inset,
              left: L.runLeft ? -3 : inset,
              right: L.runRight ? -3 : inset,
              backgroundColor: s.bg,
              backgroundImage: s.bgImage,
              backgroundSize: s.bgSize,
              border: s.border,
              borderTopLeftRadius: L.runLeft ? 0 : 999,
              borderBottomLeftRadius: L.runLeft ? 0 : 999,
              borderTopRightRadius: L.runRight ? 0 : 999,
              borderBottomRightRadius: L.runRight ? 0 : 999,
            }}
          />
        );
      })}
      <span
        className="relative z-10 font-medium leading-none"
        style={{ color: numberColor, textDecoration: top && DAY_STYLE[top.type].strike ? "line-through" : undefined }}
      >
        {day}
      </span>
    </button>
  );
}

function MonthGrid({
  year,
  month,
  typesFor,
  onEnter,
  onLeave,
  onTap,
}: {
  year: number;
  month: number;
  typesFor: (iso: string) => DayType[];
  onEnter: (iso: string, el: HTMLElement) => void;
  onLeave: () => void;
  onTap: (iso: string) => void;
}) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < CELLS) cells.push(null);

  const hasType = (idx: number, type: DayType): boolean => {
    const d = cells[idx];
    return d != null && typesFor(isoDate(year, month, d)).includes(type);
  };
  const rowRun = (idx: number, type: DayType): number => {
    const col = idx % 7;
    let len = 1;
    for (let c = col - 1, j = idx - 1; c >= 0 && hasType(j, type); c--, j--) len++;
    for (let c = col + 1, j = idx + 1; c <= 6 && hasType(j, type); c++, j++) len++;
    return len;
  };

  return (
    <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] shadow-sm p-3 h-full">
      <p className="text-center text-[15px] font-semibold text-[var(--fg)] mb-2">
        {MONTH_NAMES[month]} {year}
      </p>
      <div className="grid grid-cols-7 mb-1">
        {WEEK.map((w, i) => (
          <span key={i} className="text-center text-[10px] font-semibold uppercase text-[var(--secondary)]">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (d === null) return <span key={i} className="aspect-square" />;
          const iso = isoDate(year, month, d);
          const types = typesFor(iso);
          const col = i % 7;
          const layers: Layer[] = PILL_TYPES.filter((t) => types.includes(t))
            .map((type) => ({
              type,
              runLen: rowRun(i, type),
              runLeft: col > 0 && hasType(i - 1, type),
              runRight: col < 6 && hasType(i + 1, type),
            }))
            .sort((a, b) => b.runLen - a.runLen)
            .map(({ type, runLeft, runRight }) => ({ type, runLeft, runRight }));
          return (
            <DayCell
              key={i}
              day={d}
              iso={iso}
              layers={layers}
              weekend={col === 0 || col === 6}
              onEnter={onEnter}
              onLeave={onLeave}
              onTap={onTap}
            />
          );
        })}
      </div>
    </div>
  );
}

function CalendarioInner() {
  const router = useRouter();
  const params = useSearchParams();
  const plan = (params.get("plan") === "tecnicaturas" ? "tecnicaturas" : "ingenierias") as CalendarPlan;

  const [tareas, setTareas] = useState<TareaEvent[]>([]);
  const [loadingTareas, setLoadingTareas] = useState(true);
  const [detail, setDetail] = useState<string | null>(null);
  const [tip, setTip] = useState<{ iso: string; x: number; y: number } | null>(null);
  const [canHover, setCanHover] = useState(false);
  const [enabled, setEnabled] = useState<Record<DayType, boolean>>(
    () => Object.fromEntries(LEGEND.map((l) => [l.type, true])) as Record<DayType, boolean>
  );

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) router.push("/");
  }, [router]);

  useEffect(() => {
    setCanHover(window.matchMedia("(hover: hover)").matches);
  }, []);

  useEffect(() => {
    setLoadingTareas(true);
    fetch("/api/calendar", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setTareas(j.events ?? []))
      .catch(() => setTareas([]))
      .finally(() => setLoadingTareas(false));
  }, []);

  const dayMap = useMemo(() => {
    const map = buildAcademicMap(plan);
    for (const ev of tareas) {
      const arr = map.get(ev.date) ?? [];
      if (!arr.includes(ev.kind)) arr.push(ev.kind);
      map.set(ev.date, arr);
    }
    return map;
  }, [plan, tareas]);

  const tareasByDate = useMemo(() => {
    const m = new Map<string, TareaEvent[]>();
    for (const ev of tareas) {
      const arr = m.get(ev.date) ?? [];
      arr.push(ev);
      m.set(ev.date, arr);
    }
    return m;
  }, [tareas]);

  // typesFor aplica el filtro de Referencias.
  const typesFor = (iso: string) => (dayMap.get(iso) ?? []).filter((t) => enabled[t]);

  function describeDay(iso: string) {
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const title = `${WEEKDAY_NAMES[date.getDay()]} ${d} de ${MONTH_NAMES[m - 1].toLowerCase()} de ${y}`;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);
    const relative =
      diff === 0 ? "Hoy" : diff > 0 ? `Faltan ${diff} día${diff !== 1 ? "s" : ""}` : `Hace ${-diff} día${-diff !== 1 ? "s" : ""}`;
    const events = typesFor(iso).map((t) => {
      const label = LEGEND.find((l) => l.type === t)?.label ?? t;
      const detailLines =
        t === "tarea_inicio" || t === "tarea_fin"
          ? (tareasByDate.get(iso) ?? []).filter((e) => e.kind === t).map((e) => `${e.title} · ${e.course}`)
          : undefined;
      return { type: t, label, detail: detailLines };
    });
    return { title, relative, events };
  }

  const tipInfo = tip ? describeDay(tip.iso) : null;
  const toggle = (type: DayType, v: boolean) => setEnabled((e) => ({ ...e, [type]: v }));

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-4 pt-12 pb-12">
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Calendario" }]} />

        <div className="mb-5">
          <h1 className="text-[26px] font-bold text-[var(--fg)] tracking-tight">Calendario académico 2026</h1>
          <p className="text-[14px] text-[var(--secondary)] mt-0.5">
            {plan === "ingenierias" ? "Ingenierías" : "Licenciatura y Tecnicatura"}
            {loadingTareas ? " · cargando tareas…" : ""}
          </p>
        </div>

        <div className="lg:flex lg:items-start lg:gap-5">
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {CALENDAR_MONTHS.map(({ year, month }) => (
                <div
                  key={`${year}-${month}`}
                  className={isPeriodoLectivo(year, month) ? "rounded-2xl ring-1 ring-[var(--accent)]/20" : ""}
                >
                  <MonthGrid
                    year={year}
                    month={month}
                    typesFor={typesFor}
                    onEnter={(iso, el) => {
                      if (!canHover) return;
                      const r = el.getBoundingClientRect();
                      setTip({ iso, x: r.left + r.width / 2, y: r.top });
                    }}
                    onLeave={() => setTip(null)}
                    onTap={(iso) => {
                      if (!canHover) setDetail(iso);
                    }}
                  />
                </div>
              ))}
            </div>

            {loadingTareas && (
              <div className="mt-4">
                <SpinnerBlock label="Buscando tus tareas…" size={22} minHeight={60} />
              </div>
            )}
          </div>

          {/* Referencias = filtro (PC, derecha) */}
          <aside className="hidden lg:block w-64 shrink-0 sticky top-20">
            <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] shadow-sm p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)] mb-2">
                Referencias
              </p>
              <LegendFilter enabled={enabled} onToggle={toggle} />
            </div>
          </aside>
        </div>

        {/* Referencias = filtro (móvil, abajo) */}
        <div className="lg:hidden mt-5 bg-[var(--surface)] rounded-2xl border border-[var(--separator)] shadow-sm p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)] mb-2">
            Referencias
          </p>
          <LegendFilter enabled={enabled} onToggle={toggle} />
        </div>
      </main>

      {/* Tooltip hover (PC) */}
      {canHover && tip && tipInfo && (
        <div
          className="fixed z-[60] pointer-events-none -translate-x-1/2 -translate-y-full"
          style={{ left: Math.min(Math.max(tip.x, 120), (typeof window !== "undefined" ? window.innerWidth : 1200) - 120) as number, top: tip.y - 8 } as CSSProperties}
        >
          <div className="rounded-2xl border border-[var(--separator)] bg-[var(--surface)] shadow-2xl px-3.5 py-2.5 w-max max-w-[240px]">
            <p className="text-[13px] font-semibold text-[var(--fg)] capitalize">{tipInfo.title}</p>
            <p className="text-[12px] text-[var(--accent)] mb-1">{tipInfo.relative}</p>
            {tipInfo.events.length > 0 ? (
              <ul className="space-y-1">
                {tipInfo.events.map((e, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[12px] text-[var(--secondary)]">
                    <Swatch type={e.type} size={12} />
                    <span>
                      {e.label}
                      {e.detail?.map((d, j) => (
                        <span key={j} className="block text-[var(--fg)]">{d}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[var(--secondary)]">Sin eventos.</p>
            )}
          </div>
        </div>
      )}

      {/* Popup tap (móvil) */}
      {detail && (() => {
        const info = describeDay(detail);
        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
            role="dialog"
            aria-modal="true"
          >
            <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={() => setDetail(null)} />
            <div className="relative w-full bg-[var(--surface)] border border-[var(--separator)] rounded-t-3xl shadow-2xl p-5 pb-7" style={{ animation: "sheet-up 0.28s ease-out" }}>
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[var(--separator)]" />
              <p className="text-[16px] font-bold text-[var(--fg)] capitalize">{info.title}</p>
              <p className="text-[13px] text-[var(--accent)] mb-3">{info.relative}</p>
              <div className="space-y-2.5">
                {info.events.length > 0 ? (
                  info.events.map((e, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <Swatch type={e.type} />
                      <div>
                        <p className="text-[14px] font-medium text-[var(--fg)]">{e.label}</p>
                        {e.detail?.map((d, j) => (
                          <p key={j} className="text-[12px] text-[var(--secondary)]">{d}</p>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-[14px] text-[var(--secondary)]">Sin eventos.</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="mt-5 w-full py-3 rounded-2xl bg-[var(--surface2)] text-[var(--fg)] font-semibold text-[15px] active:opacity-80"
              >
                Cerrar
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default function CalendarioPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg)]"><Navbar /></div>}>
      <CalendarioInner />
    </Suspense>
  );
}
