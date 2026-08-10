"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  AlertTriangle,
  Bell,
  Ban,
  CalendarX,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
import DropdownSelect from "@/components/DropdownSelect";
import { isGuestMode, triggerGuestBlock } from "@/lib/guest";
import { buildSchedule, fmtRemaining } from "@/lib/horarios";
import { normalizeMateriaName } from "@/lib/officialSchedule";
import { mapCursadoToMaterias } from "@/lib/sysacadMappers";
import { useCursado } from "@/lib/sysacadHooks";

type InasItem = { CodMateria?: string; NombreMateria?: string; Materia?: string; Fecha?: string };
type InasResp = {
  Inasistencias?: InasItem[];
  data?: InasItem[];
  Materias?: { NombreMateria?: string; Materia?: string; Inasistencias?: { Fecha?: string }[] }[];
};
type Grupo = { materia: string; fechas: string[] };

// El selector siempre se arma desde el año actual (constante), nunca desde el
// año seleccionado — si no, al elegir un año anterior se "perdían" los más nuevos.
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

const historyFetcher = async (url: string): Promise<InasResp | null> => {
  const res = await fetch(url, { cache: "no-store" });
  // 401 = sesión de Sysacad vencida → lo propagamos para pedir re-login.
  if (res.status === 401) throw Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
  if (!res.ok) return null;
  return res.json();
};

function getLegajo(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/sysacadws_user=([^;]+)/);
  if (!m) return null;
  try {
    return (JSON.parse(decodeURIComponent(m[1])) as { legajo?: string }).legajo ?? null;
  } catch {
    return null;
  }
}

function normalize(resp: InasResp | null): Grupo[] {
  if (!resp) return [];

  if (Array.isArray(resp.Materias)) {
    return resp.Materias.map((m) => ({
      materia: m.NombreMateria || m.Materia || "Materia",
      fechas: (m.Inasistencias ?? []).map((x) => x.Fecha ?? "").filter(Boolean),
    })).filter((g) => g.fechas.length > 0);
  }

  const flat = resp.Inasistencias ?? resp.data ?? [];
  const map = new Map<string, string[]>();
  for (const it of flat) {
    const materia = it.NombreMateria || it.Materia || it.CodMateria || "Materia";
    if (!map.has(materia)) map.set(materia, []);
    if (it.Fecha) map.get(materia)!.push(it.Fecha);
  }

  return [...map.entries()].map(([materia, fechas]) => ({ materia, fechas }));
}

function formatDate(value: string): string {
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return value;
}

export default function AsistenciaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const legajo = ready ? getLegajo() : null;

  const { data: history, isLoading, error: historyError } = useSWR(
    legajo ? `/api/sysacadws/cursado/inasistencias/${legajo}/${year}` : null,
    historyFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60_000, shouldRetryOnError: false }
  );
  // Sesión de Sysacad vencida → mostramos el aviso de re-login (igual que sin legajo).
  const sessionExpired = (historyError as { status?: number } | undefined)?.status === 401;

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    setIsAdmin(document.cookie.includes("admin_ui=1"));
    queueMicrotask(() => setReady(true));
  }, [router]);

  // Solo datos reales: si el año no tiene inasistencias, no se inventa nada.
  const grupos = useMemo(() => normalize(history ?? null), [history]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <Navbar />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(0,122,255,0.16),transparent_32rem),var(--bg)] dark:bg-[radial-gradient(circle_at_top_left,rgba(10,132,255,0.18),transparent_30rem),var(--bg)]">
      <Navbar />

      <main className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-3xl flex-col px-4 pt-12 pb-12">
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Asistencia" }]} />

        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-[var(--secondary)]">Modulo remoto</p>
            <h1 className="text-[30px] font-bold tracking-tight text-[var(--fg)]">Asistencias</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRefreshTick((t) => t + 1)}
              disabled={refreshing}
              aria-label="Refrescar materias disponibles"
              className="flex h-11 items-center justify-center gap-1.5 rounded-[14px] bg-[rgba(255,255,255,0.68)] px-3 text-[#007aff] shadow-sm ring-1 ring-[var(--separator)] backdrop-blur-xl transition-opacity active:opacity-70 disabled:opacity-60 dark:bg-[rgba(44,44,46,0.7)] dark:text-[#0a84ff]"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden text-[14px] font-semibold sm:inline">Refrescar</span>
            </button>
            <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[rgba(255,255,255,0.68)] text-[#007aff] shadow-sm ring-1 ring-[var(--separator)] backdrop-blur-xl dark:bg-[rgba(44,44,46,0.7)] dark:text-[#0a84ff]">
              <ShieldCheck className="h-5 w-5" />
            </span>
          </div>
        </div>

        <MarcarAsistenciaCard refreshTick={refreshTick} onLoadingChange={setRefreshing} />

        <section className="mb-4 rounded-[24px] border border-[var(--separator)] bg-[rgba(255,255,255,0.68)] p-2 shadow-sm backdrop-blur-xl dark:bg-[rgba(30,31,32,0.72)]">
          <div className="flex gap-1 overflow-x-auto">
            {YEAR_OPTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setYear(item)}
                className={`min-h-10 flex-1 rounded-[16px] px-4 text-[14px] font-semibold transition ${
                  item === year
                    ? "bg-[var(--fg)] text-[var(--bg)] shadow-sm"
                    : "text-[var(--secondary)] active:bg-[var(--surface2)]"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </section>

        {isLoading && <SpinnerBlock label="Consultando inasistencias..." />}

        {/* Panel admin — solo visible cuando hay cookie admin_session_token */}
        {isAdmin && <AdminNotifyCard />}

        {!isLoading && (
          <section className="overflow-hidden rounded-[26px] border border-[var(--separator)] bg-[rgba(255,255,255,0.72)] shadow-sm backdrop-blur-xl dark:bg-[rgba(30,31,32,0.76)]">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div>
                <h2 className="text-[17px] font-semibold text-[var(--fg)]">Historial de inasistencias</h2>
                <p className="text-[13px] text-[var(--secondary)]">
                  {legajo ? `Legajo ${legajo}` : "Vinculá tu cuenta para continuar"}
                </p>
              </div>
              {legajo && (
                <span className="rounded-full bg-[#ff95001a] px-3 py-1 text-[12px] font-semibold text-[#ff9500]">
                  {grupos.reduce((acc, g) => acc + g.fechas.length, 0)} faltas
                </span>
              )}
            </div>

            <div className="h-px bg-[var(--separator)]" />

            {!legajo || sessionExpired ? (
              <div className="flex flex-col items-center gap-4 px-5 py-10 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[rgba(0,122,255,0.1)]">
                  <KeyRound className="h-7 w-7 text-[#007aff]" />
                </span>
                <div>
                  <p className="text-[15px] font-semibold text-[var(--fg)]">
                    {sessionExpired ? "Tu sesión de Sysacad expiró" : "Iniciá sesión en Sysacad"}
                  </p>
                  <p className="mt-1 text-[13px] text-[var(--secondary)]">
                    {sessionExpired
                      ? "Volvé a iniciar sesión en Sysacad para ver tu historial de inasistencias."
                      : "Para ver tu historial de inasistencias necesitás vincular tu cuenta."}
                  </p>
                </div>
                <Link
                  href="/sysacad?next=/asistencia"
                  className="flex items-center gap-2 rounded-full bg-[#007aff] px-6 py-2.5 text-[14px] font-semibold text-white shadow-[0_4px_14px_rgba(0,122,255,0.3)] transition-opacity active:opacity-80"
                >
                  Ir a Sysacad
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            ) : grupos.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                <CalendarX className="h-8 w-8 text-[#34c759]" />
                <p className="text-[14px] text-[var(--secondary)]">Sin inasistencias registradas en {year}.</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--separator)]">
                {grupos.map((grupo) => (
                  <SubjectAccordion
                    key={grupo.materia}
                    grupo={grupo}
                    open={open === grupo.materia}
                    onToggle={() => setOpen(open === grupo.materia ? null : grupo.materia)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        <section className="mt-4">
          <PushPermissionCard />
        </section>
      </main>
    </div>
  );
}

// ─── Marcar asistencia (proxied server-side; ver lib/asistenciaLegacy.ts) ─────

type LegacyMateria = {
  id: string;
  anio: string;
  especialidad: string;
  plan: string;
  comision: string;
  condicional: boolean;
  habilitada: boolean;
  nombre: string;
};
type LegacyRegistrada = { materia: string; hora: string };
type LegacyStatus = { materias: LegacyMateria[]; registradasHoy: LegacyRegistrada[] };

type ToastState = { ok: boolean; msg: string; materia: string } | null;

function MarcarAsistenciaCard({
  refreshTick,
  onLoadingChange,
}: {
  refreshTick: number;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const guest = isGuestMode();
  const legajo = guest ? null : getLegajo();
  const [status, setStatus] = useState<LegacyStatus | null>(null);
  const [loading, setLoading] = useState(() => !guest);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsAuth(false);
    try {
      const res = await fetch("/api/asistencia-legacy/status", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          setNeedsAuth(true);
        } else {
          setError(data.error ?? "No se pudo conectar con el sistema de asistencias.");
        }
        setStatus(null);
        return;
      }
      setStatus(data);
      const marcadas = new Set(data.registradasHoy.map((r: LegacyRegistrada) => normalizeMateriaName(r.materia)));
      const pend = data.materias.filter((m: LegacyMateria) => !marcadas.has(normalizeMateriaName(m.nombre)));
      setSelectedId((prev) => (prev && pend.some((m: LegacyMateria) => m.id === prev) ? prev : (pend[0]?.id ?? "")));
    } catch {
      setError("Error de conexión con el sistema de asistencias.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (guest) return;
    load();
  }, [guest, load, refreshTick]);

  useEffect(() => {
    onLoadingChange?.(loading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Tira del countdown de la materia seleccionada — se necesita el reloj vivo.
  useEffect(() => {
    if (guest) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [guest]);

  // Cuenta regresiva hasta que termina la clase: el sistema viejo solo dice
  // "habilitada sí/no", no hasta qué hora. Se cruza la materia seleccionada
  // con el horario real (Sysacad) de hoy para saber cuándo se corta.
  const { data: cursado } = useCursado(legajo ?? undefined);
  const notas = useMemo(() => mapCursadoToMaterias(cursado?.Comisiones ?? []), [cursado]);
  const slots = useMemo(() => buildSchedule(notas), [notas]);

  // Materias habilitadas que TODAVÍA no se marcaron hoy — una vez registrada,
  // desaparece del select en vez de quedar ahí invitando a marcarla de nuevo.
  const pendientes = useMemo(() => {
    if (!status) return [];
    const marcadas = new Set(status.registradasHoy.map((r) => normalizeMateriaName(r.materia)));
    return status.materias.filter((m) => !marcadas.has(normalizeMateriaName(m.nombre)));
  }, [status]);

  // Si la materia elegida deja de estar pendiente (se marcó, o cambió la
  // grilla), se recalcula acá en vez de sincronizarlo con un efecto aparte.
  const effectiveSelectedId = pendientes.some((m) => m.id === selectedId) ? selectedId : (pendientes[0]?.id ?? "");
  const selected = pendientes.find((m) => m.id === effectiveSelectedId) ?? null;

  async function handleMarcar() {
    if (guest) {
      triggerGuestBlock();
      return;
    }
    if (!effectiveSelectedId || submitting) return;
    setSubmitting(true);
    setToast(null);
    try {
      const ipRes = await fetch("https://api.ipify.org?format=json");
      const { ip } = (await ipRes.json()) as { ip: string };

      const res = await fetch("/api/asistencia-legacy/marcar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, idMateria: effectiveSelectedId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ ok: false, msg: data.error ?? "No se pudo marcar la asistencia.", materia: "" });
        return;
      }
      setStatus({ materias: data.materias, registradasHoy: data.registradasHoy });
      setToast({
        ok: data.ok,
        materia: data.materia,
        msg: data.ok
          ? data.yaEstaba
            ? "Ya tenías asistencia registrada hoy"
            : "¡Asistencia marcada!"
          : "No se pudo confirmar el registro — revisá el historial en un momento.",
      });
    } catch {
      setToast({ ok: false, msg: "No se pudo obtener tu IP pública — revisá tu conexión.", materia: "" });
    } finally {
      setSubmitting(false);
    }
  }

  const options = useMemo(() => pendientes.map((m) => ({ value: m.id, label: m.nombre })), [pendientes]);

  const remainingSec = useMemo(() => {
    if (!selected) return null;
    const nombreSel = normalizeMateriaName(selected.nombre);
    const slot = slots.find((s) => s.day === now.getDay() && normalizeMateriaName(s.materia) === nombreSel);
    if (!slot) return null;
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const remaining = slot.endMin * 60 - nowSec;
    return remaining > 0 ? remaining : null;
  }, [selected, slots, now]);

  return (
    <section className="relative mb-4 overflow-hidden rounded-[26px] border border-[var(--separator)] bg-[rgba(255,255,255,0.72)] shadow-sm backdrop-blur-xl dark:bg-[rgba(30,31,32,0.76)]">
      <ResultToast toast={toast} onClose={() => setToast(null)} />

      <div className="flex items-center gap-3.5 px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[rgba(52,199,89,0.14)]">
          <CheckCircle2 className="h-5 w-5 text-[#34c759]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-[var(--fg)]">Marcar asistencia</p>
          <p className="mt-0.5 text-[12px] text-[var(--secondary)]">Solo funciona conectado a la red de la facultad</p>
        </div>
        {remainingSec != null && (
          <span
            className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums ${
              remainingSec < 300 ? "bg-[#ff3b301a] text-[#ff3b30]" : "bg-[#ff95001a] text-[#ff9500]"
            }`}
          >
            <Clock className="h-3 w-3" />
            {fmtRemaining(remainingSec)}
          </span>
        )}
      </div>

      <div className="border-t border-[var(--separator)] px-5 py-4">
        {guest ? (
          <button
            type="button"
            onClick={() => triggerGuestBlock()}
            className="w-full rounded-[16px] bg-[var(--surface2)] py-3 text-[14px] font-semibold text-[var(--secondary)]"
          >
            No disponible en modo invitado
          </button>
        ) : loading ? (
          <p className="text-[13px] text-[var(--secondary)]">Consultando materias habilitadas…</p>
        ) : needsAuth ? (
          <Link
            href="/sysacad?next=/asistencia"
            className="flex items-center justify-between gap-2 rounded-[16px] bg-[rgba(0,122,255,0.08)] px-4 py-3 text-[13px] font-semibold text-[#007aff] active:opacity-80"
          >
            <span className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0" />
              Iniciá sesión en Sysacad para marcar asistencia
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </Link>
        ) : error ? (
          <div className="flex items-center gap-2 text-[13px] text-[#ff3b30]">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : !status || status.materias.length === 0 ? (
          <p className="text-[13px] text-[var(--secondary)]">Ninguna materia tiene la asistencia habilitada en este momento.</p>
        ) : (
          <>
            {pendientes.length === 0 ? (
              <div className="flex items-center gap-2 text-[13px] text-[#34c759]">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Ya marcaste asistencia en todo lo habilitado por ahora.</span>
              </div>
            ) : (
              <>
                <DropdownSelect
                  value={effectiveSelectedId}
                  options={options}
                  onChange={(v) => {
                    setSelectedId(v);
                    setToast(null);
                  }}
                  placeholder="Elegí una materia"
                />

                {selected?.condicional && (
                  <InlineAlert tone="warning" icon={AlertTriangle}>
                    Estás cursando <strong>{selected.nombre}</strong> de forma condicional.
                  </InlineAlert>
                )}
                {selected && !selected.habilitada && (
                  <InlineAlert tone="danger" icon={Ban}>
                    El docente todavía no habilitó la asistencia para <strong>{selected.nombre}</strong>.
                  </InlineAlert>
                )}

                <button
                  type="button"
                  onClick={handleMarcar}
                  disabled={submitting || !selected?.habilitada}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-[16px] bg-[#34c759] py-3 text-[14px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {submitting ? "Marcando…" : "Marcar asistencia"}
                </button>
              </>
            )}

            {status.registradasHoy.length > 0 && (
              <div className="mt-4 border-t border-[var(--separator)] pt-3">
                <p className="mb-2 text-[12px] font-semibold text-[var(--secondary)]">Asistencias registradas hoy</p>
                <div className="flex flex-col gap-1.5">
                  {status.registradasHoy.map((r, i) => (
                    <div
                      key={`${r.materia}-${i}`}
                      className="flex items-center justify-between rounded-[12px] bg-[var(--surface2)] px-3 py-2 text-[13px]"
                    >
                      <span className="text-[var(--fg)]">{r.materia}</span>
                      <span className="text-[var(--secondary)]">{r.hora}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Chip de aviso inline — reemplaza los textos rojos/naranjas sueltos de antes. */
function InlineAlert({
  tone,
  icon: Icon,
  children,
}: {
  tone: "warning" | "danger";
  icon: typeof AlertTriangle;
  children: React.ReactNode;
}) {
  const styles =
    tone === "warning"
      ? "bg-[#ff95001a] text-[#ff9500] border-[#ff950033]"
      : "bg-[#ff3b301a] text-[#ff3b30] border-[#ff3b3033]";
  return (
    <div className={`mt-2.5 flex items-start gap-2 rounded-[14px] border px-3 py-2.5 text-[12.5px] leading-snug ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Toast flotante para el resultado de marcar asistencia (éxito o error). */
function ResultToast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!toast) return;
    timerRef.current = setTimeout(onClose, 4500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-center"
      style={{ animation: "toast-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
    >
      <div
        className={`pointer-events-auto flex w-full items-center gap-3 rounded-[18px] border px-4 py-3.5 shadow-lg backdrop-blur-xl ${
          toast.ok
            ? "border-[#34c75933] bg-[rgba(52,199,89,0.95)] text-white"
            : "border-[#ff3b3033] bg-[rgba(255,59,48,0.95)] text-white"
        }`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
          {toast.ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold leading-tight">{toast.msg}</p>
          {toast.materia && <p className="mt-0.5 truncate text-[12px] font-medium text-white/85">{toast.materia}</p>}
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-full p-1 active:bg-white/20" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function PushPermissionCard() {
  // Próximamente: la suscripción a alertas push todavía no está habilitada
  // para los alumnos. Se deja el botón siempre inactivo y visualmente
  // apagado en vez de sacar la tarjeta, para no perder el lugar reservado
  // en la pantalla el día que se habilite.
  return (
    <div className="rounded-[26px] border border-[var(--separator)] bg-[rgba(255,255,255,0.72)] p-5 shadow-sm backdrop-blur-xl dark:bg-[rgba(30,31,32,0.76)] opacity-70">
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-[var(--surface2)] text-[var(--secondary)]">
          <Bell className="h-6 w-6" />
        </span>
        <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--secondary)]">
          Próximamente
        </span>
      </div>
      <h2 className="mt-4 text-[18px] font-semibold text-[var(--fg)]">Alertas push</h2>
      <p className="mt-1 min-h-10 text-[13px] leading-relaxed text-[var(--secondary)]">
        Estamos trabajando en esta función. Todavía no está disponible.
      </p>
      <button
        type="button"
        disabled
        className="mt-3 min-h-11 w-full rounded-[16px] bg-[var(--surface2)] px-4 text-[14px] font-semibold text-[var(--secondary)] opacity-70"
      >
        Próximamente
      </button>
    </div>
  );
}

// ─── Tarjeta admin: disparar notificación push manualmente ────────────────────

type NotifyState = "idle" | "loading" | "success" | "error";

function AdminNotifyCard() {
  const [state, setState] = useState<NotifyState>("idle");
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  async function trigger() {
    if (state === "loading") return;
    setState("loading");
    setResult(null);
    try {
      const res = await fetch("/api/asistencia/notify", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setResult({ sent: data.sent ?? 0, failed: data.failed ?? 0 });
      setState(res.ok && (data.failed ?? 0) === 0 ? "success" : "error");
    } catch {
      setState("error");
    } finally {
      setTimeout(() => setState("idle"), 5000);
    }
  }

  return (
    <section className="mb-4 overflow-hidden rounded-[26px] border border-[rgba(175,82,222,0.25)] bg-[rgba(175,82,222,0.06)] shadow-sm backdrop-blur-xl">
      <div className="flex items-start gap-3.5 px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[rgba(175,82,222,0.14)]">
          <ShieldCheck className="h-5 w-5 text-[#af52de]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--fg)]">Admin — Disparar notificación</p>
          <p className="mt-0.5 text-[12px] text-[var(--secondary)]">
            Envía push &quot;asistencia disponible&quot; a todos los suscriptores.
          </p>
        </div>
      </div>

      <div className="border-t border-[rgba(175,82,222,0.15)] px-5 py-3 flex items-center justify-between gap-3">
        <div className="text-[13px] text-[var(--secondary)]">
          {state === "success" && result && (
            <span className="text-[#34c759] font-semibold">
              ✓ Enviadas {result.sent} / {result.sent + result.failed}
            </span>
          )}
          {state === "error" && result && (
            <span className="text-[#ff3b30] font-semibold">
              Fallidas {result.failed} / {result.sent + result.failed}
            </span>
          )}
          {state === "error" && !result && (
            <span className="text-[#ff3b30] font-semibold">Error de red</span>
          )}
        </div>
        <button
          type="button"
          onClick={trigger}
          disabled={state === "loading"}
          className="flex items-center gap-2 rounded-full bg-[#af52de] px-5 py-2 text-[14px] font-semibold text-white transition-all duration-300 active:scale-95 disabled:opacity-50"
        >
          {state === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {state === "loading" ? "Enviando…" : "Enviar"}
        </button>
      </div>

      <Link
        href="/admin/testnotis"
        className="flex items-center gap-3 border-t border-[rgba(175,82,222,0.15)] px-5 py-3 transition-colors active:bg-[var(--surface2)]"
      >
        <span className="flex-1 text-[13px] font-medium text-[#af52de]">Abrir simulador PWA</span>
        <ChevronRight className="h-4 w-4 text-[#af52de]" />
      </Link>
    </section>
  );
}

function SubjectAccordion({ grupo, open, onToggle }: { grupo: Grupo; open: boolean; onToggle: () => void }) {
  return (
    <div>
      <button type="button" onClick={onToggle} className="flex min-h-[68px] w-full items-center gap-3 px-5 py-3 text-left active:bg-[var(--surface2)]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#ff95001a] text-[#ff9500]">
          <CalendarX className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-snug text-[var(--fg)]">{grupo.materia}</span>
          <span className="block text-[12px] text-[var(--secondary)]">
            {grupo.fechas.length > 0 ? `${grupo.fechas.length} fecha${grupo.fechas.length === 1 ? "" : "s"}` : "Sin fechas cargadas"}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--secondary)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="bg-[rgba(118,118,128,0.08)] px-5 py-3 dark:bg-[rgba(255,255,255,0.04)]">
          {grupo.fechas.length > 0 ? (
            <div className="grid gap-2">
              {grupo.fechas.map((fecha) => (
                <div key={fecha} className="flex min-h-10 items-center gap-3 rounded-[14px] bg-[var(--surface)] px-3 text-[14px] font-medium text-[var(--fg)]">
                  <span className="h-2 w-2 rounded-full bg-[#ff3b30]" />
                  {formatDate(fecha)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-[var(--secondary)]">
              El HTML aportado lista esta materia; las fechas exactas llegan por el endpoint AJAX de detalle cuando el servidor original responde.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
