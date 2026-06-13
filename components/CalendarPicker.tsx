"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

type Props = {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  min?: string; // YYYY-MM-DD
  max?: string; // YYYY-MM-DD
};

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function parseDate(str: string): Date | null {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export default function CalendarPicker({ value, onChange, min, max }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedDate = parseDate(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const minDate = min ? parseDate(min) : today;
  const maxDate = max ? parseDate(max) : null;

  // Viewing month state
  const initial = selectedDate ?? today;
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  // Sync view when value changes externally
  useEffect(() => {
    if (selectedDate) {
      setViewYear(selectedDate.getFullYear());
      setViewMonth(selectedDate.getMonth());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Build day grid for current view month
  // First day of month (JS: 0=Sun, we want 0=Mon)
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  let startDow = firstOfMonth.getDay(); // 0=Sun
  startDow = startDow === 0 ? 6 : startDow - 1; // shift to Mon=0

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  function isDisabled(day: number) {
    const d = new Date(viewYear, viewMonth, day);
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay(); // 0=Dom, 6=Sáb
    if (dow === 0 || dow === 6) return true;
    if (minDate && d < minDate) return true;
    if (maxDate && d > maxDate) return true;
    return false;
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  function selectDay(day: number) {
    if (isDisabled(day)) return;
    const d = new Date(viewYear, viewMonth, day);
    onChange(toISO(d));
    setOpen(false);
  }

  const displayValue = selectedDate
    ? selectedDate.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })
    : "Seleccionar fecha";

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          "w-full flex items-center justify-between gap-2",
          "rounded-xl border bg-[var(--surface2)] px-3.5 py-2.5",
          "text-[14px] text-left outline-none transition-all duration-150",
          open
            ? "border-[#007aff] ring-2 ring-[#007aff]/20"
            : "border-[var(--separator)]",
          "cursor-pointer hover:border-[#007aff]/50",
        ].join(" ")}
      >
        <span className={selectedDate ? "text-[var(--fg)]" : "text-[var(--secondary)]"}>
          {displayValue}
        </span>
        <CalendarDays className="w-4 h-4 flex-shrink-0 text-[var(--secondary)]" />
      </button>

      {/* Inline calendar below */}
      {open && (
        <div
          className={[
            "absolute left-0 right-0 z-50 mt-1.5",
            "rounded-2xl border border-[var(--navbar-border)]",
            "bg-[var(--surface)] backdrop-blur-xl shadow-lg p-4",
            "animate-in fade-in slide-in-from-top-1 duration-150",
          ].join(" ")}
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={prevMonth}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--surface2)] transition-colors text-[var(--secondary)] hover:text-[var(--fg)]"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[14px] font-semibold text-[var(--fg)]">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--surface2)] transition-colors text-[var(--secondary)] hover:text-[var(--fg)]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[11px] font-semibold text-[var(--secondary)] uppercase tracking-wider py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} />;
              const cellDate = new Date(viewYear, viewMonth, day);
              cellDate.setHours(0, 0, 0, 0);
              const isToday = sameDay(cellDate, today);
              const isSel = selectedDate ? sameDay(cellDate, selectedDate) : false;
              const disabled = isDisabled(day);

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => selectDay(day)}
                  disabled={disabled}
                  className={[
                    "relative mx-auto flex items-center justify-center",
                    "w-9 h-9 rounded-full text-[13px] font-medium transition-all duration-100",
                    disabled
                      ? "text-[var(--secondary)]/40 cursor-not-allowed"
                      : isSel
                      ? "bg-[#007aff] text-white shadow-sm"
                      : isToday
                      ? "bg-[#007aff]/15 text-[#007aff] font-semibold hover:bg-[#007aff]/25"
                      : "text-[var(--fg)] hover:bg-[var(--surface2)]",
                  ].join(" ")}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
