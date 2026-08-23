"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  KeyRound,
  ListTodo,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
import WorkspaceLayout, { usePdfPreview } from "@/components/CourseWorkspaceLayout";
import type { TareaItem } from "@/app/api/tareas/route";
import { reportClientError } from "@/lib/clientErrorReporter";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

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

// ─── Stream NDJSON ──────────────────────────────────────────────────────────
//
// /api/tareas devuelve una línea de meta ({years, year}) y después una línea
// por tarea apenas Moodle responde, en vez de un único JSON al final. Así la
// lista se va llenando incrementalmente en vez de esperar a la más lenta.

const CURRENT_YEAR = new Date().getFullYear();

type StreamLine =
  | { type: "meta"; years: number[]; year: number }
  | { type: "tarea"; item: TareaItem };

interface TareasError extends Error {
  status?: number;
}

// Caché por año a nivel de módulo (no por instancia de componente): al salir
// de /tareas y volver, la página se remonta pero este Map sigue vivo mientras
// dure la pestaña, así que no hay que re-streamear todo de nuevo.
const tareasCache = new Map<number, { tareas: TareaItem[]; years: number[] }>();

/** Lee /api/tareas?year= como NDJSON y va empujando tareas a medida que llegan. */
function useTareasStream(year: number | null) {
  const [tareas, setTareas] = useState<TareaItem[]>([]);
  const [years, setYears] = useState<number[]>([CURRENT_YEAR]);
  const [streamYear, setStreamYear] = useState<number | null>(null);
  const [error, setError] = useState<TareasError | null>(null);
  // true mientras el stream del año pedido sigue trayendo tareas — distinto de
  // "no hay datos todavía": permite no mostrar "no tenés tareas" en falso
  // mientras siguen llegando líneas.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (year === null) return;

    // Caché en memoria por año: si ya lo cargamos en esta sesión, no re-streameamos.
    const cached = tareasCache.get(year);
    if (cached) {
      setTareas(cached.tareas);
      setYears(cached.years);
      setStreamYear(year);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setError(null);
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(`/api/tareas?year=${year}`, { cache: "no-store", signal: controller.signal });
        if (res.status === 401) throw Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
        if (!res.ok || !res.body) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "No se pudieron cargar las tareas.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const collected: TareaItem[] = [];
        let metaYears = [year];
        let started = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const parsed = JSON.parse(line) as StreamLine;
            if (parsed.type === "meta") {
              metaYears = parsed.years;
              if (cancelled) continue;
              if (!started) { setTareas([]); started = true; }
              setYears(parsed.years);
              setStreamYear(parsed.year);
            } else if (parsed.type === "tarea") {
              collected.push(parsed.item);
              if (!cancelled) setTareas((prev) => [...prev, parsed.item]);
            }
          }
        }

        if (!cancelled) {
          tareasCache.set(year, { tareas: collected, years: metaYears });
          setLoading(false);
        }
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") return;
        setError(err as TareasError);
        setLoading(false);
        const status = (err as TareasError).status;
        if (status !== 401) {
          reportClientError("warning", `Carga de tareas (año ${year}): ${(err as Error).message}`, {
            stack: (err as Error).stack ?? null,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [year]);

  return { tareas, years, streamYear, error, loading };
}

// ─── Agrupado por materia ───────────────────────────────────────────────────

interface CourseGroup {
  course: string;
  courseId: number;
  color: string;
  items: TareaItem[];
  earliest: number;
}

const dueMs = (t: TareaItem) => (t.due ? new Date(t.due).getTime() : Number.POSITIVE_INFINITY);

/** Agrupa por materia; cada grupo ordenado por cierre más próximo, grupos por su ítem más urgente. */
function groupByCourseDueAsc(items: TareaItem[]): CourseGroup[] {
  const byCourse = new Map<string, TareaItem[]>();
  for (const t of items) {
    const arr = byCourse.get(t.course) ?? [];
    arr.push(t);
    byCourse.set(t.course, arr);
  }
  const out = [...byCourse.entries()].map(([course, list]) => {
    const sorted = [...list].sort((a, b) => dueMs(a) - dueMs(b));
    return { course, courseId: sorted[0].courseId, color: courseColor(course), items: sorted, earliest: dueMs(sorted[0]) };
  });
  out.sort((a, b) => a.earliest - b.earliest);
  return out;
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function TareasPage() {
  const router = useRouter();
  const online = useOnlineStatus();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("pendientes");
  const [year, setYear] = useState(CURRENT_YEAR);
  const [now, setNow] = useState(() => new Date());
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsedCourses, setCollapsedCourses] = useState<Set<string>>(new Set());

  const toggleCourse = (course: string) => {
    setCollapsedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(course)) next.delete(course);
      else next.add(course);
      return next;
    });
  };

  const toggleSearch = () => {
    setSearchOpen((open) => {
      const next = !open;
      if (!next) setQuery("");
      return next;
    });
  };

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) { router.replace("/"); return; }
    setAuthed(true);
  }, [router]);

  // Refresca la noción de "ahora" cada minuto para mantener la urgencia al día.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { tareas: streamedTareas, years, streamYear, error, loading: streaming } = useTareasStream(authed ? year : null);

  const tareas = streamYear === year ? streamedTareas : undefined;
  // "Listo" en cuanto arrancó el stream del año pedido (aunque sigan llegando
  // tareas de a una) — así la lista se puede ir pintando incrementalmente.
  const ready = streamYear === year;

  // Si el año pedido no existe (p.ej. el alumno no cursa nada este año), el
  // backend resuelve el más reciente — sincronizamos la selección para no
  // quedarnos esperando datos de un año que nunca llega.
  useEffect(() => {
    if (streamYear !== null && streamYear !== year && !years.includes(year)) setYear(streamYear);
  }, [years, year, streamYear]);

  // Sesión del Campus expirada: en vez de expulsar, mostramos un aviso con un
  // botón para reingresar y volver acá. Las tareas vienen del Campus (Moodle).
  const sessionExpired = (error as { status?: number } | undefined)?.status === 401;

  const all = useMemo(() => tareas ?? [], [tareas]);
  const pending = useMemo(() => all.filter((t) => !t.submitted), [all]);
  const completed = useMemo(() => all.filter((t) => t.submitted), [all]);

  // Agrupa por materia. Pendientes ordenadas por urgencia; grupos por su tarea
  // más urgente. Completadas alfabéticas.
  const groups = useMemo(() => {
    if (tab === "pendientes") return groupByCourseDueAsc(pending);
    const byCourse = new Map<string, TareaItem[]>();
    for (const t of completed) {
      const arr = byCourse.get(t.course) ?? [];
      arr.push(t);
      byCourse.set(t.course, arr);
    }
    const out = [...byCourse.entries()].map(([course, items]) => {
      const sorted = [...items].sort((a, b) => a.title.localeCompare(b.title));
      return { course, courseId: sorted[0].courseId, color: courseColor(course), items: sorted, earliest: dueMs(sorted[0]) };
    });
    out.sort((a, b) => a.course.localeCompare(b.course));
    return out;
  }, [tab, pending, completed]);

  // Búsqueda global (título o materia) sobre todas las tareas del año, sin
  // distinguir pendiente/completada — ordenada por cierre más próximo y
  // agrupada por materia cuando hay varias coincidencias.
  const trimmedQuery = query.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;
  const searchGroups = useMemo(() => {
    if (!trimmedQuery) return [];
    const matches = all.filter(
      (t) => t.title.toLowerCase().includes(trimmedQuery) || t.course.toLowerCase().includes(trimmedQuery)
    );
    return groupByCourseDueAsc(matches);
  }, [trimmedQuery, all]);

  const visibleGroups = isSearching ? searchGroups : groups;

  const errorMsg =
    error && error.message !== "UNAUTHORIZED"
      ? online
        ? error.message
        : "Sin conexión — estas tareas todavía no se guardaron para verlas sin internet."
      : "";
  const showSpinner = !ready && !errorMsg && !sessionExpired;
  // Todavía no terminó de traer todas las tareas del año — evita mostrar el
  // estado vacío ("no tenés tareas...") mientras siguen llegando de a una.
  const stillLoadingList = !showSpinner && streaming;
  const showEmpty = !showSpinner && !errorMsg && !sessionExpired && !stillLoadingList && visibleGroups.length === 0;
  const showInlineLoader = !showSpinner && !errorMsg && !sessionExpired && stillLoadingList && visibleGroups.length === 0;
  const showList = !showSpinner && !errorMsg && !sessionExpired && visibleGroups.length > 0;

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

          {/* Segmented control + botón de búsqueda */}
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1 grid grid-cols-2 h-11 p-1 rounded-full bg-[var(--surface2)] select-none">
              {/* Loader "alrededor" de la píldora: el propio borde se va rellenando
                  de transparente a azul mientras el stream sigue trayendo tareas,
                  y se desvanece apenas termina de cargar. Dos capas: el gradiente
                  gira detrás, una tapa sólida del mismo color deja ver solo el
                  borde. */}
              <span aria-hidden className="pill-loader-ring-outer" style={{ opacity: streaming ? 1 : 0 }} />
              <span aria-hidden className="pill-loader-ring-inner" />

              <span
                className="absolute z-10 inset-y-1 rounded-full bg-[var(--surface)] shadow-sm transition-all duration-300 ease-out"
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
                    className={`relative z-10 flex items-center justify-center gap-1.5 text-[14px] font-semibold rounded-full transition-colors ${
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

            <button
              type="button"
              onClick={toggleSearch}
              aria-label={searchOpen ? "Cerrar búsqueda" : "Buscar tarea"}
              aria-pressed={searchOpen}
              className={`h-11 w-11 shrink-0 rounded-full flex items-center justify-center transition-colors ${
                searchOpen ? "bg-[var(--fg)] text-[var(--bg)]" : "bg-[var(--surface2)] text-[var(--secondary)] active:bg-[var(--surface2)]"
              }`}
            >
              <Search className="w-[18px] h-[18px]" />
            </button>
          </div>

          {searchOpen && (
            <div className="mb-5" style={{ animation: "fade-in 0.15s ease" }}>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--secondary)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por tarea o materia…"
                  className="w-full h-11 rounded-full bg-[var(--surface2)] pl-10 pr-10 text-[14px] text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-[var(--secondary)] hover:text-[var(--fg)]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {!searchOpen && <div className="mb-2" />}

          {showSpinner && <SpinnerBlock label="Buscando tus tareas…" />}

          {!showSpinner && sessionExpired && (
            <div className="bg-[var(--surface)] border border-[var(--separator)] rounded-2xl shadow-sm px-6 py-10 flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: "var(--accent-light)" }}>
                <KeyRound className="w-6 h-6 text-[#007aff]" />
              </div>
              <p className="text-[16px] font-semibold text-[var(--fg)]">Tu sesión del Campus expiró</p>
              <p className="text-[14px] text-[var(--secondary)] mt-1 max-w-xs">
                Volvé a iniciar sesión en el Campus para ver tus tareas.
              </p>
              <Link
                href={`/?next=${encodeURIComponent("/tareas")}`}
                className="mt-5 inline-flex items-center justify-center rounded-full bg-[#007aff] px-5 py-2.5 text-[15px] font-semibold text-white shadow-sm transition-opacity active:opacity-80"
              >
                Iniciar sesión
              </Link>
            </div>
          )}

          {!showSpinner && errorMsg && (
            <div className="rounded-2xl border border-[#ffcdd2] bg-[#fff2f2] p-4 text-sm text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]">
              {errorMsg}
            </div>
          )}

          {showInlineLoader && <SpinnerBlock label={isSearching ? "Buscando…" : "Buscando tus tareas…"} minHeight={72} />}

          {showEmpty && (isSearching ? <SearchEmptyState query={query} /> : <EmptyState tab={tab} />)}

          {showList && (
            <div key={isSearching ? "search" : tab} style={{ animation: "fade-in 0.2s ease" }} className="space-y-6">
              {visibleGroups.map((g) => (
                <CourseAccordion
                  key={g.course}
                  group={g}
                  now={now}
                  collapsed={collapsedCourses.has(g.course)}
                  onToggle={toggleCourse}
                />
              ))}
            </div>
          )}
        </div>
      </WorkspaceLayout>
    </div>
  );
}

// ─── Acordeón por materia ──────────────────────────────────────────────────

function CourseAccordion({
  group,
  now,
  collapsed,
  onToggle,
}: {
  group: CourseGroup;
  now: Date;
  collapsed: boolean;
  onToggle: (course: string) => void;
}) {
  return (
    <section>
      <div className="px-1 py-1.5 mb-2 flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
        <Link
          href={`/course/${group.courseId}`}
          className="flex-1 min-w-0 text-[13px] font-bold uppercase tracking-wide truncate transition-opacity active:opacity-60 hover:opacity-70"
          style={{ color: group.color }}
        >
          {group.course}
          <ArrowUpRight className="inline-block ml-1 w-3 h-3 opacity-60 shrink-0" />
        </Link>
        <span className="text-[12px] font-semibold text-[var(--secondary)] tabular-nums shrink-0">{group.items.length}</span>
        <button
          type="button"
          onClick={() => onToggle(group.course)}
          aria-label={collapsed ? `Expandir ${group.course}` : `Colapsar ${group.course}`}
          aria-expanded={!collapsed}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full active:bg-[var(--surface2)]"
        >
          <ChevronDown className={`w-4 h-4 text-[var(--secondary)] transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        </button>
      </div>

      {!collapsed && (
        <div className="bg-[var(--surface)] rounded-3xl border border-[var(--separator)] overflow-hidden shadow-sm divide-y divide-[var(--separator)]">
          {group.items.map((t) => (
            <TareaRow key={t.id} tarea={t} now={now} />
          ))}
        </div>
      )}
    </section>
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

function SearchEmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4" style={{ backgroundColor: "var(--surface2)" }}>
        <Search className="w-8 h-8 text-[var(--secondary)]" />
      </div>
      <p className="text-[16px] font-bold text-[var(--fg)]">Sin resultados</p>
      <p className="text-[14px] text-[var(--secondary)] mt-1 max-w-xs">
        No encontramos tareas ni materias que coincidan con &ldquo;{query}&rdquo;.
      </p>
    </div>
  );
}
