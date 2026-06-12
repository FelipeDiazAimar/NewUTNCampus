"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
import CustomEventModal from "@/components/horarios/CustomEventModal";
import MateriaSettingsModal from "@/components/horarios/MateriaSettingsModal";
import { buildSchedule, colorMap, DAY_LABELS, DAY_SHORT, fmtRemaining } from "@/lib/horarios";
import { hhmmToMin, type CustomScheduleEvent } from "@/lib/customEvents";
import { getAllMateriaSettings, type MateriaSettings } from "@/lib/materiaSettings";
import { mapCursadoToMaterias } from "@/lib/sysacadMappers";
import type { SysacadCursado } from "@/lib/sysacadws";
import type { MateriaCursando } from "@/lib/sysacadTypes";

const DAYS = [1, 2, 3, 4, 5, 6, 0]; // Lunes a Domingo

type DayItem = {
  key: string;
  id?: string;
  startMin: number;
  endMin: number;
  start: string;
  end: string;
  title: string;
  subtitle: string;
  color: string;
  custom: boolean;
};

const evFetcher = async (u: string): Promise<{ data: CustomScheduleEvent[] }> => {
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) return { data: [] };
  return r.json();
};

/** Lee el legajo del web service desde la cookie legible. */
function getWsLegajo(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/sysacadws_user=([^;]+)/);
  if (!m) return null;
  try {
    return (JSON.parse(decodeURIComponent(m[1])) as { legajo?: string }).legajo ?? null;
  } catch {
    return null;
  }
}

// Cursado desde el web service (coninasistencia) → grilla. Sin scraping ni ping.
const notasFetcher = async (url: string): Promise<MateriaCursando[]> => {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 401) throw Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
  const json = (await res.json()) as SysacadCursado & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo cargar el cursado.");
  return mapCursadoToMaterias(json.Comisiones ?? []);
};

export default function HorariosPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [legajo, setLegajo] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMateria, setEditingMateria] = useState<string | null>(null);
  const [materiaSettings, setMateriaSettings] = useState<Record<string, MateriaSettings>>({});

  const today = now.getDay();
  const [day, setDay] = useState(() => {
    const d = new Date().getDay();
    return DAYS.includes(d) ? d : 1;
  });

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) { router.replace("/"); return; }
    const lj = getWsLegajo();
    if (!lj) { router.replace("/sysacad"); return; }
    setLegajo(lj);
    setAuthed(true);
    setMateriaSettings(getAllMateriaSettings());
  }, [router]);

  const { data: notas, error: notasError, isLoading: loading } = useSWR(
    authed && legajo ? `/api/sysacadws/cursado/coninasistencia/${legajo}` : null,
    notasFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60_000, keepPreviousData: true }
  );

  useEffect(() => {
    if ((notasError as { status?: number } | undefined)?.status === 401) {
      router.replace("/sysacad");
    }
  }, [notasError, router]);

  const { data: customRes, mutate } = useSWR("/api/schedule-events", evFetcher, { revalidateOnFocus: false });

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const slots = useMemo(() => buildSchedule(notas ?? []), [notas]);
  const defaultColors = useMemo(() => colorMap(slots), [slots]);

  const items = useMemo<DayItem[]>(() => {
    const classItems: DayItem[] = slots
      .filter((s) => s.day === day)
      .map((s, i) => {
        const saved = materiaSettings[s.materia] ?? {};
        const color = saved.color ?? defaultColors.get(s.materia) ?? "#8e8e93";
        const aulaText = saved.aula ?? s.aula;
        return {
          key: `cls-${i}`,
          startMin: s.startMin,
          endMin: s.endMin,
          start: s.start,
          end: s.end,
          title: s.materia,
          subtitle: [aulaText, s.faltas > 0 ? `${s.faltas} ${s.faltas === 1 ? "falta" : "faltas"}` : ""].filter(Boolean).join(" · "),
          color,
          custom: false,
        };
      });
    const customItems: DayItem[] = (customRes?.data ?? [])
      .filter((e) => e.day_of_week === day)
      .map((e) => ({
        key: `cus-${e.id}`,
        id: e.id,
        startMin: hhmmToMin(e.start_time),
        endMin: hhmmToMin(e.end_time),
        start: e.start_time.slice(0, 5),
        end: e.end_time.slice(0, 5),
        title: e.title,
        subtitle: e.description ?? "",
        color: e.color_hex,
        custom: true,
      }));
    return [...classItems, ...customItems].sort((a, b) => a.startMin - b.startMin);
  }, [slots, defaultColors, materiaSettings, customRes, day]);

  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = day === today;

  let currentIdx = -1;
  let nextIdx = -1;
  if (isToday) {
    currentIdx = items.findIndex((s) => s.startMin <= nowMin && nowMin < s.endMin);
    nextIdx = items.findIndex((s) => s.startMin > nowMin);
  }

  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 45) return;
    const idx = DAYS.indexOf(day);
    const nextI = dx < 0 ? Math.min(DAYS.length - 1, idx + 1) : Math.max(0, idx - 1);
    setDay(DAYS[nextI]);
  };

  async function deleteEvent(id: string) {
    await fetch(`/api/schedule-events?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    mutate();
  }

  const errorMsg = notasError?.message !== "UNAUTHORIZED" ? notasError?.message : "";

  // Para el modal de edición
  const editingDefaultColor = editingMateria ? (defaultColors.get(editingMateria) ?? "#007aff") : "#007aff";
  const editingCurrent = editingMateria ? (materiaSettings[editingMateria] ?? {}) : {};
  const editingRawAula = editingMateria ? (slots.find((s) => s.materia === editingMateria)?.aula ?? "") : "";

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />
      <main className="max-w-xl mx-auto px-4 pt-12 pb-12">
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Horarios" }]} />

        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-bold text-[var(--fg)] tracking-tight">Horarios</h1>
            <p className="text-[14px] text-[var(--secondary)] mt-0.5">Tu cursada de la semana</p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] text-white text-[14px] font-semibold px-3.5 py-2 active:opacity-80 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Evento
          </button>
        </div>

        {/* Tabs de días */}
        <div className="flex gap-1 mb-3 overflow-x-auto">
          {DAYS.map((d) => {
            const active = d === day;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                className={`px-3.5 py-1.5 rounded-full text-[14px] font-semibold whitespace-nowrap transition-colors ${
                  active ? "bg-[var(--accent)] text-white" : "text-[var(--secondary)] active:bg-[var(--surface2)]"
                }`}
              >
                {DAY_SHORT[d]}
              </button>
            );
          })}
        </div>

        {loading && !notas && <SpinnerBlock label="Cargando horarios…" />}

        {!loading && errorMsg && (
          <div className="rounded-2xl border border-[#ffcdd2] bg-[#fff2f2] p-4 text-sm text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]">
            {errorMsg}
          </div>
        )}

        {(!loading || notas) && !errorMsg && (
          <div
            className="rounded-3xl border border-[var(--navbar-border)] overflow-hidden shadow-sm"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div className="px-4 py-3 bg-[var(--surface2)]">
              <p className="text-[18px] font-bold text-[var(--fg)]">{isToday ? "Hoy" : DAY_LABELS[day]}</p>
            </div>

            {items.length === 0 ? (
              <div className="bg-[var(--surface)] px-4 py-10 text-center">
                <p className="text-[14px] text-[var(--secondary)]">No tenés nada este día.</p>
              </div>
            ) : (
              <div key={day} style={{ animation: "fade-in 0.2s ease" }}>
                {items.map((s, i) => (
                  <div key={s.key} className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: s.color }}>
                    <span className="w-4 text-center text-[14px] font-bold" style={{ color: "rgba(0,0,0,0.55)" }}>
                      {i + 1}
                    </span>
                    <div className="flex flex-col leading-tight text-[12px] font-semibold tabular-nums" style={{ color: "rgba(0,0,0,0.7)" }}>
                      <span>{s.start}</span>
                      <span>{s.end}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-bold leading-snug" style={{ color: "#1c1c1e" }}>
                        {s.title}
                      </p>
                      {s.subtitle && (
                        <p className="text-[12px] leading-snug truncate" style={{ color: "rgba(0,0,0,0.65)" }}>
                          {s.subtitle}
                        </p>
                      )}
                    </div>

                    {i === currentIdx ? (
                      <span className="shrink-0 rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-bold tabular-nums text-[#1c1c1e]">
                        {fmtRemaining(s.endMin * 60 - nowSec)}
                      </span>
                    ) : i === nextIdx ? (
                      <span className="shrink-0 rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-semibold text-[#1c1c1e]">
                        Siguiente
                      </span>
                    ) : null}

                    {!s.custom ? (
                      <button
                        type="button"
                        onClick={() => setEditingMateria(s.title)}
                        className="shrink-0 p-1.5 rounded-full active:bg-black/10"
                        style={{ color: "rgba(0,0,0,0.55)" }}
                        aria-label="Editar materia"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    ) : s.id ? (
                      <button
                        type="button"
                        onClick={() => deleteEvent(s.id!)}
                        className="shrink-0 p-1.5 rounded-full active:bg-black/10"
                        style={{ color: "rgba(0,0,0,0.55)" }}
                        aria-label="Eliminar evento"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <CustomEventModal
        open={modalOpen}
        defaultDay={day}
        onClose={() => setModalOpen(false)}
        onCreated={() => mutate()}
      />

      <MateriaSettingsModal
        materia={editingMateria}
        current={editingCurrent}
        defaultColor={editingDefaultColor}
        rawAula={editingRawAula}
        onClose={() => setEditingMateria(null)}
        onSaved={(name, s) => setMateriaSettings((prev) => ({ ...prev, [name]: s }))}
      />
    </div>
  );
}
