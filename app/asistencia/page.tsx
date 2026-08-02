"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Bell,
  CalendarX,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Loader2,
  Send,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";

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
          <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[rgba(255,255,255,0.68)] text-[#007aff] shadow-sm ring-1 ring-[var(--separator)] backdrop-blur-xl dark:bg-[rgba(44,44,46,0.7)] dark:text-[#0a84ff]">
            <ShieldCheck className="h-5 w-5" />
          </span>
        </div>

        <section className="mb-4">
          <PushPermissionCard />
        </section>

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
      </main>
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
            Envía push "asistencia disponible" a todos los suscriptores.
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
