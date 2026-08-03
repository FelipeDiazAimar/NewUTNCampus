"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
import CustomEventModal from "@/components/horarios/CustomEventModal";
import MateriaSettingsModal from "@/components/horarios/MateriaSettingsModal";
import { buildSchedule, colorMap, DAY_LABELS, DAY_SHORT, fmtRemaining } from "@/lib/horarios";
import { hhmmToMin, type CustomScheduleEvent } from "@/lib/customEvents";
import { getAllMateriaSettings, type MateriaSettings } from "@/lib/materiaSettings";
import { mapCursadoToMaterias } from "@/lib/sysacadMappers";
import { useCursado } from "@/lib/sysacadHooks";
import { isGuestMode, triggerGuestBlock } from "@/lib/guest";
import type { OfficialSlot } from "@/lib/officialSchedule";

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
  /** Aula que figura en la grilla oficial de la carrera, si difiere de la de Sysacad. */
  aulaMismatch?: string;
};

const evFetcher = async (u: string): Promise<{ data: CustomScheduleEvent[] }> => {
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) return { data: [] };
  return r.json();
};

const oficialFetcher = async (u: string): Promise<{ slots: OfficialSlot[] }> => {
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) return { slots: [] };
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

  // Mismo hook que /materias y /sysacad → comparte caché con la MISMA forma de
  // dato (evita la colisión de claves SWR que dejaba la grilla vacía). Mapeamos
  // a la grilla en el cliente.
  const { data: cursado, error: notasError, isLoading: loading } = useCursado(
    authed && legajo ? legajo : undefined
  );
  const notas = useMemo(() => mapCursadoToMaterias(cursado?.Comisiones ?? []), [cursado]);
  const expired = (notasError as { status?: number } | undefined)?.status === 401;

  useEffect(() => {
    if (expired) router.replace("/sysacad");
  }, [expired, router]);

  const { data: customRes, mutate } = useSWR("/api/schedule-events", evFetcher, { revalidateOnFocus: false });
  // Grilla oficial de la carrera (sanfrancisco.utn.edu.ar): se cachea 1 día en
  // el servidor, así que acá alcanza con traerla una vez por sesión.
  const { data: oficialRes } = useSWR("/api/horarios-oficiales", oficialFetcher, { revalidateOnFocus: false });

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const slots = useMemo(() => buildSchedule(notas ?? [], oficialRes?.slots ?? []), [notas, oficialRes]);
  const defaultColors = useMemo(() => colorMap(slots), [slots]);

  const itemsFor = useCallback(
    (targetDay: number): DayItem[] => {
      const classItems: DayItem[] = slots
        .filter((s) => s.day === targetDay)
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
            // Si el usuario ya pisó el aula a mano en Ajustes, no tiene sentido avisarle.
            aulaMismatch: saved.aula ? undefined : s.aulaMismatch,
          };
        });
      const customItems: DayItem[] = (customRes?.data ?? [])
        .filter((e) => e.day_of_week === targetDay)
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
    },
    [slots, defaultColors, materiaSettings, customRes]
  );

  const dayIdx = DAYS.indexOf(day);
  const prevDay = DAYS[(dayIdx - 1 + DAYS.length) % DAYS.length];
  const nextDay = DAYS[(dayIdx + 1) % DAYS.length];

  const items = useMemo(() => itemsFor(day), [itemsFor, day]);
  const prevItems = useMemo(() => itemsFor(prevDay), [itemsFor, prevDay]);
  const nextItems = useMemo(() => itemsFor(nextDay), [itemsFor, nextDay]);

  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Arrastre para cambiar de día: se engancha en toda la tarjeta (no solo en
  // un borde), con feedback en vivo (el contenido sigue al dedo) y bloqueo de
  // eje para no pelear con el scroll vertical de la página. `touchAction:
  // "pan-y"` le avisa al navegador que el scroll vertical lo maneja él mismo,
  // así no hace falta un preventDefault agresivo que podría trabarlo.
  //
  // El carrusel se arma con 3 paneles (anterior/actual/siguiente) uno al lado
  // del otro dentro de una tira 3x más ancha, centrada en el panel actual
  // (-33.333%). Arrastrar suma píxeles a ese offset, así el panel vecino
  // aparece "desde el lado contrario" durante el gesto en vez de un corte
  // abrupto. Al soltar, si superó el umbral, la tira termina de animar hasta
  // dejar el panel vecino a pantalla completa y recién ahí (onTransitionEnd)
  // se actualiza `day` y se recentra sin transición (salto invisible, porque
  // el contenido ya es idéntico al que se veía).
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const axisLock = useRef<"x" | "y" | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [commitDir, setCommitDir] = useState<"next" | "prev" | null>(null);
  const [noTransition, setNoTransition] = useState(false);
  const SWIPE_DECIDE_PX = 8; // cuánto hay que moverse antes de decidir el eje
  const SWIPE_COMMIT_PX = 55; // cuánto hay que arrastrar para cambiar de día

  useEffect(() => {
    if (!noTransition) return;
    const id = requestAnimationFrame(() => setNoTransition(false));
    return () => cancelAnimationFrame(id);
  }, [noTransition]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (commitDir) return; // ya animando el cambio de día, ignorar toques nuevos
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    axisLock.current = null;
    setDragging(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;

    if (axisLock.current === null) {
      if (Math.abs(dx) < SWIPE_DECIDE_PX && Math.abs(dy) < SWIPE_DECIDE_PX) return;
      axisLock.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axisLock.current === "x") setDragX(dx);
  };

  const onTouchEnd = () => {
    if (axisLock.current === "x" && Math.abs(dragX) > SWIPE_COMMIT_PX) {
      setDragging(false);
      setCommitDir(dragX < 0 ? "next" : "prev");
    } else {
      setDragging(false);
      setDragX(0);
    }
    touchStart.current = null;
    axisLock.current = null;
  };

  const onStripTransitionEnd = () => {
    if (!commitDir) return;
    const idx = DAYS.indexOf(day);
    const delta = commitDir === "next" ? 1 : -1;
    const newIdx = (idx + delta + DAYS.length) % DAYS.length;
    setNoTransition(true);
    setDay(DAYS[newIdx]);
    setCommitDir(null);
    setDragX(0);
  };

  const baseFraction = commitDir === "next" ? -200 / 3 : commitDir === "prev" ? 0 : -100 / 3;
  const stripTransform = dragging
    ? `translateX(calc(${baseFraction}% + ${dragX}px))`
    : `translateX(${baseFraction}%)`;
  const stripTransition = dragging || noTransition ? "none" : "transform 0.28s cubic-bezier(0.25, 0.1, 0.25, 1)";

  async function deleteEvent(id: string) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
    await fetch(`/api/schedule-events?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    mutate();
  }

  const errorMsg = notasError && !expired ? "No se pudo cargar el cursado." : "";
  const showSpinner = loading && !cursado && !errorMsg;

  // Para el modal de edición
  const editingDefaultColor = editingMateria ? (defaultColors.get(editingMateria) ?? "#007aff") : "#007aff";
  const editingCurrent = editingMateria ? (materiaSettings[editingMateria] ?? {}) : {};
  const editingRawAula = editingMateria ? (slots.find((s) => s.materia === editingMateria)?.aula ?? "") : "";

  function renderDayPanel(d: number, dayItems: DayItem[]) {
    const panelIsToday = d === today;
    let currentIdx = -1;
    let nextIdx = -1;
    if (panelIsToday) {
      currentIdx = dayItems.findIndex((s) => s.startMin <= nowMin && nowMin < s.endMin);
      nextIdx = dayItems.findIndex((s) => s.startMin > nowMin);
    }

    return (
      <div className="flex min-h-[60vh] flex-col bg-[var(--surface)]">
        <div className="px-4 py-3 bg-[var(--surface2)]">
          <p className="text-[18px] font-bold text-[var(--fg)]">{panelIsToday ? "Hoy" : DAY_LABELS[d]}</p>
        </div>

        {dayItems.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4 py-10 text-center">
            <p className="text-[14px] text-[var(--secondary)]">No tenés nada este día.</p>
          </div>
        ) : (
          <div className="flex-1">
            {dayItems.map((s, i) => (
              <div key={s.key} className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: s.color }}>
                <span className="w-4 text-center text-[14px] font-bold" style={{ color: "rgba(0,0,0,0.55)" }}>
                  {i + 1}
                </span>
                <div className="flex flex-col leading-tight text-[12px] font-semibold tabular-nums" style={{ color: "rgba(0,0,0,0.7)" }}>
                  <span>{s.start}</span>
                  <span>{s.end}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold leading-snug flex items-center gap-1.5" style={{ color: "#1c1c1e" }}>
                    <span className="truncate">{s.title}</span>
                    {s.aulaMismatch && (
                      <AlertTriangle
                        className="w-3.5 h-3.5 shrink-0"
                        style={{ color: "rgba(0,0,0,0.55)" }}
                        aria-label={`La grilla oficial de la facultad dice Aula ${s.aulaMismatch}`}
                      />
                    )}
                  </p>
                  {s.subtitle && (
                    <p className="text-[12px] leading-snug truncate" style={{ color: "rgba(0,0,0,0.65)" }}>
                      {s.subtitle}
                    </p>
                  )}
                  {s.aulaMismatch && (
                    <p className="text-[11px] leading-snug truncate" style={{ color: "rgba(0,0,0,0.55)" }}>
                      La facultad publica Aula {s.aulaMismatch}
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
    );
  }

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

        {/* Tabs de días: siempre las 7 visibles, sin scroll ni drag. */}
        <div className="grid grid-cols-7 gap-1 mb-3">
          {DAYS.map((d) => {
            const active = d === day;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                className={`py-1.5 rounded-full text-[13px] font-semibold text-center transition-colors ${
                  active ? "bg-[var(--accent)] text-white" : "text-[var(--secondary)] active:bg-[var(--surface2)]"
                }`}
              >
                {DAY_SHORT[d]}
              </button>
            );
          })}
        </div>

        {showSpinner && <SpinnerBlock label="Cargando horarios…" />}

        {!showSpinner && errorMsg && (
          <div className="rounded-2xl border border-[#ffcdd2] bg-[#fff2f2] p-4 text-sm text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]">
            {errorMsg}
          </div>
        )}

        {!showSpinner && !errorMsg && (
          <div
            className="min-h-[60vh] rounded-3xl border border-[var(--navbar-border)] overflow-hidden shadow-sm"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={{ touchAction: "pan-y" }}
          >
            <div
              className="flex"
              style={{ width: "300%", transform: stripTransform, transition: stripTransition }}
              onTransitionEnd={onStripTransitionEnd}
            >
              <div style={{ width: "33.3333%", flexShrink: 0 }}>{renderDayPanel(prevDay, prevItems)}</div>
              <div style={{ width: "33.3333%", flexShrink: 0 }}>{renderDayPanel(day, items)}</div>
              <div style={{ width: "33.3333%", flexShrink: 0 }}>{renderDayPanel(nextDay, nextItems)}</div>
            </div>
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
