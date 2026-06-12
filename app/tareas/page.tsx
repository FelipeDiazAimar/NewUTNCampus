"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  ListTodo,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
import WorkspaceLayout, { usePdfPreview } from "@/components/CourseWorkspaceLayout";
import type { TareaItem } from "@/app/api/tareas/route";

type Tab = "pendientes" | "completadas";

// ─── Colores por materia (hash estable a la paleta iOS) ───────────────────────

const PALETTE = [
  "#007aff", "#34c759", "#ff9500", "#af52de",
  "#30b0c7", "#ff3b30", "#5856d6", "#ff2d55",
];
function courseColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ─── Urgencia de la fecha de cierre ───────────────────────────────────────────

const DAY = 86_400_000;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

interface Urgency {
  label: string;
  tone: string;
  bg: string;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function urgency(dueIso: string | null, now: Date): Urgency {
  if (!dueIso) return { label: "Sin fecha", tone: "var(--secondary)", bg: "var(--surface2)" };
  const due = new Date(dueIso);
  if (Number.isNaN(due.getTime())) return { label: "Sin fecha", tone: "var(--secondary)", bg: "var(--surface2)" };

  const diff = due.getTime() - now.getTime();
  const red = { tone: "#ff3b30", bg: "rgba(255,59,48,0.12)" };
  const orange = { tone: "#ff9500", bg: "rgba(255,149,0,0.12)" };
  const gray = { tone: "var(--secondary)", bg: "var(--surface2)" };

  if (diff < 0) {
    const days = Math.floor(-diff / DAY);
    return { label: days >= 1 ? `Venció hace ${days} d` : "Vencida", ...red };
  }
  if (sameDay(due, now)) {
    const hrs = Math.max(1, Math.round(diff / 3_600_000));
    return { label: `Vence hoy · ${hrs} h`, ...red };
  }
  const tomorrow = new Date(now.getTime() + DAY);
  if (sameDay(due, tomorrow)) return { label: "Vence mañana", ...orange };

  const days = Math.ceil(diff / DAY);
  if (days < 3) return { label: `Vence en ${days} días`, ...orange };
  if (days <= 7) return { label: `Vence en ${days} días`, ...gray };
  return { label: `${due.getDate()} ${MONTHS[due.getMonth()]}`, ...gray };
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

interface TareasResp {
  tareas: TareaItem[];
  years: number[];
  year: number;
}

const fetcher = async (url: string): Promise<TareasResp> => {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 401) throw Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "No se pudieron cargar las tareas.");
  return { tareas: json.tareas ?? [], years: json.years ?? [CURRENT_YEAR], year: json.year ?? CURRENT_YEAR };
};

// ─── Página ───────────────────────────────────────────────────────────────────

export default function TareasPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("pendientes");
  const [year, setYear] = useState(CURRENT_YEAR);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) { router.replace("/"); return; }
    setAuthed(true);
  }, [router]);

  // Refresca la noción de "ahora" cada minuto para mantener la urgencia al día.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data, error } = useSWR(
    authed ? `/api/tareas?year=${year}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60_000, keepPreviousData: true }
  );

  const tareas = data?.tareas;
  // Años disponibles: del último response (estable, siempre el set completo).
  const years = data?.years ?? [CURRENT_YEAR];
  // "Listo" cuando los datos mostrados corresponden al año seleccionado.
  const ready = !!data && data.year === year;

  // Si el año pedido no existe (p.ej. el alumno no cursa nada este año), el
  // backend resuelve el más reciente — sincronizamos la selección para no
  // quedarnos esperando datos de un año que nunca llega.
  useEffect(() => {
    if (data && !data.years.includes(year)) setYear(data.year);
  }, [data, year]);

  useEffect(() => {
    if ((error as { status?: number } | undefined)?.status === 401) router.replace("/");
  }, [error, router]);

  const all = useMemo(() => tareas ?? [], [tareas]);
  const pending = useMemo(() => all.filter((t) => !t.submitted), [all]);
  const completed = useMemo(() => all.filter((t) => t.submitted), [all]);

  // Agrupa por materia. Pendientes ordenadas por urgencia; grupos por su tarea
  // más urgente. Completadas alfabéticas.
  const groups = useMemo(() => {
    const source = tab === "pendientes" ? pending : completed;
    const byCourse = new Map<string, TareaItem[]>();
    for (const t of source) {
      const arr = byCourse.get(t.course) ?? [];
      arr.push(t);
      byCourse.set(t.course, arr);
    }

    const dueMs = (t: TareaItem) => (t.due ? new Date(t.due).getTime() : Number.POSITIVE_INFINITY);

    const out = [...byCourse.entries()].map(([course, items]) => {
      const sorted = [...items].sort((a, b) =>
        tab === "pendientes" ? dueMs(a) - dueMs(b) : a.title.localeCompare(b.title)
      );
      return { course, color: courseColor(course), items: sorted, earliest: dueMs(sorted[0]) };
    });

    out.sort((a, b) =>
      tab === "pendientes" ? a.earliest - b.earliest : a.course.localeCompare(b.course)
    );
    return out;
  }, [tab, pending, completed]);

  const errorMsg = error && error.message !== "UNAUTHORIZED" ? error.message : "";
  const showSpinner = !ready && !errorMsg;

  return (
    <div className="min-h-screen bg-[var(--bg)] overflow-x-hidden">
      <Navbar />
      {/* WorkspaceLayout maneja el split: lista a la izquierda, tarea abierta a
          la derecha (o overlay a pantalla completa en móvil), igual que /materias. */}
      <WorkspaceLayout>
        <div className="pt-12 pb-12">
          <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Tareas" }]} />

          <div className="mb-4 flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm text-white"
              style={{ background: "linear-gradient(135deg,#0a84ff,#5e5ce6)" }}
            >
              <ListTodo className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-[26px] font-bold text-[var(--fg)] tracking-tight leading-none">Tareas</h1>
              <p className="text-[14px] text-[var(--secondary)] mt-1">Todas tus entregas en un lugar</p>
            </div>
          </div>

          {/* Selector de año (mismo estilo que /asistencia) */}
          {years.length > 1 && (
            <section className="mb-4 rounded-[24px] border border-[var(--separator)] bg-[rgba(255,255,255,0.68)] p-2 shadow-sm backdrop-blur-xl dark:bg-[rgba(30,31,32,0.72)]">
              <div className="flex gap-1 overflow-x-auto">
                {years.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setYear(y)}
                    className={`min-h-10 flex-1 rounded-[16px] px-4 text-[14px] font-semibold transition ${
                      y === year
                        ? "bg-[var(--fg)] text-[var(--bg)] shadow-sm"
                        : "text-[var(--secondary)] active:bg-[var(--surface2)]"
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Segmented control */}
          <div className="relative grid grid-cols-2 p-1 rounded-full bg-[var(--surface2)] mb-5 select-none">
            <span
              className="absolute inset-y-1 rounded-full bg-[var(--surface)] shadow-sm transition-all duration-300 ease-out"
              style={{ width: "calc(50% - 4px)", left: tab === "completadas" ? "50%" : "4px" }}
            />
            {(["pendientes", "completadas"] as Tab[]).map((t) => {
              const active = tab === t;
              const count = t === "pendientes" ? pending.length : completed.length;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`relative z-10 flex items-center justify-center gap-1.5 py-2 text-[14px] font-semibold rounded-full transition-colors ${
                    active ? "text-[var(--fg)]" : "text-[var(--secondary)]"
                  }`}
                >
                  {t === "pendientes" ? "Pendientes" : "Completadas"}
                  {tareas && count > 0 && (
                    <span
                      className="min-w-[20px] px-1.5 py-0.5 rounded-full text-[11px] font-bold leading-none"
                      style={{
                        backgroundColor: active ? (t === "pendientes" ? "rgba(255,59,48,0.14)" : "rgba(52,199,89,0.14)") : "transparent",
                        color: active ? (t === "pendientes" ? "#ff3b30" : "#34c759") : "var(--secondary)",
                      }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {showSpinner && <SpinnerBlock label="Buscando tus tareas…" />}

          {!showSpinner && errorMsg && (
            <div className="rounded-2xl border border-[#ffcdd2] bg-[#fff2f2] p-4 text-sm text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]">
              {errorMsg}
            </div>
          )}

          {!showSpinner && !errorMsg && (
            groups.length === 0 ? (
              <EmptyState tab={tab} />
            ) : (
              <div key={tab} style={{ animation: "fade-in 0.2s ease" }} className="space-y-6">
                {groups.map((g) => (
                  <section key={g.course}>
                    {/* Cabecera pegajosa de la materia */}
                    <div
                      className="sticky top-16 z-10 -mx-1 px-1 py-1.5 mb-2 flex items-center gap-2 backdrop-blur-xl"
                      style={{ background: "color-mix(in srgb, var(--bg) 80%, transparent)" }}
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                      <h2 className="flex-1 min-w-0 text-[13px] font-bold uppercase tracking-wide text-[var(--secondary)] truncate">
                        {g.course}
                      </h2>
                      <span className="text-[12px] font-semibold text-[var(--secondary)] tabular-nums">{g.items.length}</span>
                    </div>

                    {/* Inset grouped list */}
                    <div className="bg-[var(--surface)] rounded-3xl border border-[var(--separator)] overflow-hidden shadow-sm divide-y divide-[var(--separator)]">
                      {g.items.map((t) => (
                        <TareaRow key={t.id} tarea={t} now={now} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )
          )}
        </div>
      </WorkspaceLayout>
    </div>
  );
}

// ─── Fila de tarea ────────────────────────────────────────────────────────────

function TareaRow({ tarea, now }: { tarea: TareaItem; now: Date }) {
  const { openAssignment, activeAssignmentKey } = usePdfPreview();
  const isActive = activeAssignmentKey === tarea.url;
  const u = urgency(tarea.due, now);

  return (
    <button
      type="button"
      onClick={() => openAssignment({ url: tarea.url, name: tarea.title, key: tarea.url })}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
        isActive ? "bg-[var(--surface2)]" : "active:bg-[var(--surface2)]"
      }`}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={
          tarea.submitted
            ? { backgroundColor: "rgba(52,199,89,0.14)", color: "#34c759" }
            : { backgroundColor: `${u.tone === "var(--secondary)" ? "var(--surface2)" : u.bg}`, color: u.tone }
        }
      >
        {tarea.submitted ? <CheckCircle2 className="w-5 h-5" /> : <FileText className="w-[18px] h-[18px]" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-semibold text-[var(--fg)] leading-snug truncate">{tarea.title}</p>
        {tarea.submitted ? (
          <p className="text-[12.5px] leading-snug mt-0.5 truncate" style={{ color: "#34c759" }}>
            {tarea.graded && tarea.grade ? `Calificada · ${tarea.grade}` : tarea.status || "Entregada"}
          </p>
        ) : (
          <span
            className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[12px] font-semibold leading-none"
            style={{ backgroundColor: u.bg, color: u.tone }}
          >
            <Clock className="w-3 h-3" />
            {u.label}
          </span>
        )}
      </div>

      <ChevronRight
        className={`w-4 h-4 shrink-0 transition-transform ${isActive ? "rotate-90 text-[var(--accent)]" : "text-[var(--secondary)]"}`}
      />
    </button>
  );
}

// ─── Estado vacío ─────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: Tab }) {
  const pend = tab === "pendientes";
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div
        className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4"
        style={{ backgroundColor: pend ? "rgba(52,199,89,0.12)" : "var(--surface2)" }}
      >
        {pend ? <CheckCircle2 className="w-8 h-8 text-[#34c759]" /> : <ListTodo className="w-8 h-8 text-[var(--secondary)]" />}
      </div>
      <p className="text-[16px] font-bold text-[var(--fg)]">
        {pend ? "¡Estás al día!" : "Todavía nada entregado"}
      </p>
      <p className="text-[14px] text-[var(--secondary)] mt-1 max-w-xs">
        {pend
          ? "No tenés tareas pendientes de entrega."
          : "Cuando entregues una tarea, va a aparecer acá."}
      </p>
    </div>
  );
}
