"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Bell,
  BellRing,
  CalendarX,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Radio,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";

type AgentState = {
  status: "listening" | "detected" | "idle" | "offline";
  listening: boolean;
  lastSeenAt: string | null;
};

type InasItem = { CodMateria?: string; NombreMateria?: string; Materia?: string; Fecha?: string };
type InasResp = {
  Inasistencias?: InasItem[];
  data?: InasItem[];
  Materias?: { NombreMateria?: string; Materia?: string; Inasistencias?: { Fecha?: string }[] }[];
};
type Grupo = { materia: string; fechas: string[] };

const HAR_MATERIAS: Grupo[] = [
  { materia: "Administracion de Sistemas de Informacion", fechas: [] },
  { materia: "Ingenieria y Calidad de Software", fechas: [] },
  { materia: "Investigacion Operativa", fechas: [] },
  { materia: "Prospectiva Profesional (Elec.)", fechas: [] },
  { materia: "Redes de Datos", fechas: [] },
];

const agentFetcher = async (url: string): Promise<AgentState> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo consultar el agente");
  return res.json();
};

const historyFetcher = async (url: string): Promise<InasResp | null> => {
  const res = await fetch(url, { cache: "no-store" });
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

function formatRelative(value: string | null): string {
  if (!value) return "Sin registro";
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return "Sin registro";
  const mins = Math.max(0, Math.round(diff / 60000));
  if (mins < 1) return "Ahora";
  if (mins === 1) return "Hace 1 min";
  return `Hace ${mins} min`;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export default function AsistenciaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState<string | null>(null);
  const legajo = ready ? getLegajo() : null;

  const { data: agent } = useSWR("/api/asistencia/agent", agentFetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });
  const { data: history, isLoading } = useSWR(
    legajo ? `/api/sysacadws/cursado/inasistencias/${legajo}/${year}` : null,
    historyFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60_000 }
  );

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    queueMicrotask(() => setReady(true));
  }, [router]);

  const grupos = useMemo(() => {
    const live = normalize(history ?? null);
    return live.length > 0 ? live : HAR_MATERIAS;
  }, [history]);

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

      <main className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-3xl flex-col px-4 pt-20 pb-12">
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

        <section className="mb-4 grid gap-3 md:grid-cols-[1.15fr_0.85fr]">
          <AgentStatus agent={agent} />
          <PushPermissionCard />
        </section>

        <section className="mb-4 rounded-[24px] border border-[var(--separator)] bg-[rgba(255,255,255,0.68)] p-2 shadow-sm backdrop-blur-xl dark:bg-[rgba(30,31,32,0.72)]">
          <div className="flex gap-1 overflow-x-auto">
            {[year, year - 1, year - 2, year - 3].map((item) => (
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

        {!isLoading && (
          <section className="overflow-hidden rounded-[26px] border border-[var(--separator)] bg-[rgba(255,255,255,0.72)] shadow-sm backdrop-blur-xl dark:bg-[rgba(30,31,32,0.76)]">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div>
                <h2 className="text-[17px] font-semibold text-[var(--fg)]">Historial de inasistencias</h2>
                <p className="text-[13px] text-[var(--secondary)]">
                  {legajo ? `Legajo ${legajo}` : "Datos base del historial importado"}
                </p>
              </div>
              <span className="rounded-full bg-[#ff95001a] px-3 py-1 text-[12px] font-semibold text-[#ff9500]">
                {grupos.reduce((acc, g) => acc + g.fechas.length, 0)} faltas
              </span>
            </div>

            <div className="h-px bg-[var(--separator)]" />

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
          </section>
        )}
      </main>
    </div>
  );
}

function AgentStatus({ agent }: { agent?: AgentState }) {
  const status = agent?.status ?? "offline";
  const listening = agent?.listening ?? false;
  const tone = listening ? "#34c759" : status === "detected" ? "#007aff" : "#ff9500";
  const label = listening ? "Escuchando" : status === "detected" ? "Detectado" : "Sin senal";

  return (
    <div className="rounded-[26px] border border-[var(--separator)] bg-[rgba(255,255,255,0.72)] p-5 shadow-sm backdrop-blur-xl dark:bg-[rgba(30,31,32,0.76)]">
      <div className="flex items-start justify-between gap-4">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-[16px]"
          style={{ backgroundColor: `${tone}1a`, color: tone }}
        >
          {listening ? <Radio className="h-6 w-6" /> : <WifiOff className="h-6 w-6" />}
        </span>
        <span className="rounded-full px-3 py-1 text-[12px] font-semibold" style={{ backgroundColor: `${tone}1a`, color: tone }}>
          {label}
        </span>
      </div>
      <h2 className="mt-4 text-[18px] font-semibold text-[var(--fg)]">Agente Local Motorola</h2>
      <div className="mt-3 flex items-center gap-2 text-[13px] text-[var(--secondary)]">
        <Clock3 className="h-4 w-4" />
        {formatRelative(agent?.lastSeenAt ?? null)}
      </div>
    </div>
  );
}

function PushPermissionCard() {
  const [supported, setSupported] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    queueMicrotask(() => setSupported(true));

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => setSubscription(sub))
      .catch(() => setMessage("No se pudo registrar el servicio push."));
  }, []);

  async function subscribe() {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      setMessage("Falta configurar NEXT_PUBLIC_VAPID_PUBLIC_KEY.");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch("/api/notifications/push-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });

      if (!res.ok) throw new Error("No se pudo guardar la suscripcion.");
      setSubscription(sub);
      setMessage("Notificaciones activadas.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    if (!subscription) return;
    setBusy(true);

    try {
      await fetch("/api/notifications/push-subscription", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      setSubscription(null);
      setMessage("Notificaciones desactivadas.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[26px] border border-[var(--separator)] bg-[rgba(255,255,255,0.72)] p-5 shadow-sm backdrop-blur-xl dark:bg-[rgba(30,31,32,0.76)]">
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-[#007aff1a] text-[#007aff] dark:text-[#0a84ff]">
          {subscription ? <BellRing className="h-6 w-6" /> : <Bell className="h-6 w-6" />}
        </span>
        {subscription && <CheckCircle2 className="h-5 w-5 text-[#34c759]" />}
      </div>
      <h2 className="mt-4 text-[18px] font-semibold text-[var(--fg)]">Alertas push</h2>
      <p className="mt-1 min-h-10 text-[13px] leading-relaxed text-[var(--secondary)]">
        {message ?? (supported ? "Aviso inmediato cuando el agente detecte una asistencia abierta." : "Este navegador no soporta Web Push.")}
      </p>
      <button
        type="button"
        disabled={!supported || busy}
        onClick={subscription ? unsubscribe : subscribe}
        className="mt-3 min-h-11 w-full rounded-[16px] bg-[var(--fg)] px-4 text-[14px] font-semibold text-[var(--bg)] transition active:opacity-80 disabled:opacity-55"
      >
        {busy ? "Procesando..." : subscription ? "Desactivar" : "Activar"}
      </button>
    </div>
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
