"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Clock,
  AlertCircle,
  MessageCircle,
  CalendarCheck,
  ChevronRight,
  LogOut,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import Navbar from "@/components/Navbar";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type EventType =
  | "NUEVA_TAREA"
  | "TAREA_POR_VENCER"
  | "TAREA_VENCIDA"
  | "NUEVO_MENSAJE"
  | "ASISTENCIA_DISPONIBLE";

type ButtonState = "idle" | "loading" | "success" | "error";

// ─── Configuración de los eventos ─────────────────────────────────────────────

const EVENTS: {
  type: EventType;
  label: string;
  description: string;
  Icon: React.ElementType;
  color: string;
  bg: string;
}[] = [
  {
    type: "NUEVA_TAREA",
    label: "Nueva tarea",
    description: "Simula la publicación de un nuevo TP",
    Icon: BookOpen,
    color: "#007aff",
    bg: "rgba(0,122,255,0.12)",
  },
  {
    type: "TAREA_POR_VENCER",
    label: "Tarea por vencer",
    description: "Aviso de vencimiento en 24 hs",
    Icon: Clock,
    color: "#ff9500",
    bg: "rgba(255,149,0,0.12)",
  },
  {
    type: "TAREA_VENCIDA",
    label: "Tarea vencida",
    description: "Notificación de plazo expirado",
    Icon: AlertCircle,
    color: "#ff3b30",
    bg: "rgba(255,59,48,0.12)",
  },
  {
    type: "NUEVO_MENSAJE",
    label: "Nuevo mensaje",
    description: "Mensaje entrante en el chat",
    Icon: MessageCircle,
    color: "#34c759",
    bg: "rgba(52,199,89,0.12)",
  },
  {
    type: "ASISTENCIA_DISPONIBLE",
    label: "Asistencia disponible",
    description: "Portal de asistencia habilitado",
    Icon: CalendarCheck,
    color: "#af52de",
    bg: "rgba(175,82,222,0.12)",
  },
];

// ─── Fila de acción ───────────────────────────────────────────────────────────

function ActionRow({
  event,
  state,
  onFire,
}: {
  event: (typeof EVENTS)[number];
  state: ButtonState;
  onFire: () => void;
}) {
  const { Icon, label, description, color, bg } = event;

  const right = (() => {
    if (state === "loading") return <Loader2 className="h-[18px] w-[18px] animate-spin text-[var(--secondary)]" />;
    if (state === "success") return <CheckCircle2 className="h-[18px] w-[18px] text-[#34c759]" />;
    if (state === "error") return <XCircle className="h-[18px] w-[18px] text-[#ff3b30]" />;
    return <ChevronRight className="h-[18px] w-[18px] text-[var(--secondary)]" />;
  })();

  return (
    <button
      type="button"
      disabled={state === "loading"}
      onClick={onFire}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-black/5 dark:active:bg-white/5 disabled:opacity-60"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
        style={{ backgroundColor: bg, color }}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium text-[var(--fg)]">{label}</span>
        <span className="block text-[12px] text-[var(--secondary)] truncate">{description}</span>
      </span>
      {right}
    </button>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────

export default function AdminPanelClient() {
  const router = useRouter();
  const [states, setStates] = useState<Record<EventType, ButtonState>>(
    Object.fromEntries(EVENTS.map((e) => [e.type, "idle"])) as Record<EventType, ButtonState>
  );
  const [logoutLoading, setLogoutLoading] = useState(false);

  function setState(type: EventType, s: ButtonState) {
    setStates((prev) => ({ ...prev, [type]: s }));
  }

  async function fire(type: EventType) {
    if (states[type] === "loading") return;
    setState(type, "loading");
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      setState(type, res.ok ? "success" : "error");
    } catch {
      setState(type, "error");
    } finally {
      // Vuelve a idle después de 2,5 s para permitir reintentos.
      setTimeout(() => setState(type, "idle"), 2500);
    }
  }

  async function handleLogout() {
    setLogoutLoading(true);
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    router.replace("/admin/login");
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />

      <main className="mx-auto max-w-xl px-4 pt-20 pb-12">
        {/* Header */}
        <div className="mb-6">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)] mb-1">
            Herramientas internas
          </p>
          <h1 className="text-[28px] font-bold tracking-tight text-[var(--fg)]">Simulador PWA</h1>
          <p className="mt-1 text-[14px] text-[var(--secondary)]">
            Disparar notificaciones push de prueba a tus suscripciones activas.
          </p>
        </div>

        {/* Info banner */}
        <div className="mb-6 flex items-start gap-3 rounded-[16px] border border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.06)] px-4 py-3">
          <span className="mt-0.5 h-[7px] w-[7px] shrink-0 rounded-full bg-[#007aff] mt-1.5" />
          <p className="text-[13px] leading-relaxed text-[var(--secondary)]">
            Las notificaciones se envían únicamente a <strong className="text-[var(--fg)]">tus propias suscripciones</strong> registradas en este dispositivo. El resto de los usuarios no recibe nada.
          </p>
        </div>

        {/* Eventos */}
        <section className="mb-7">
          <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
            Eventos disponibles
          </p>

          <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm divide-y divide-[var(--separator)]">
            {EVENTS.map((event) => (
              <ActionRow
                key={event.type}
                event={event}
                state={states[event.type]}
                onFire={() => fire(event.type)}
              />
            ))}
          </div>
        </section>

        {/* Instrucciones */}
        <section className="mb-7">
          <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
            Requisitos
          </p>
          <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm divide-y divide-[var(--separator)]">
            {[
              { step: "1", text: "Activar notificaciones push en la página de Notificaciones" },
              { step: "2", text: "Agregar la app a la pantalla de inicio (PWA)" },
              { step: "3", text: "Configurar las variables VAPID en el servidor" },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface2)] text-[12px] font-bold text-[var(--secondary)]">
                  {step}
                </span>
                <span className="text-[14px] text-[var(--fg)]">{text}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Cerrar sesión admin */}
        <section>
          <div className="overflow-hidden rounded-[20px] border border-[rgba(255,59,48,0.2)] bg-[var(--surface)] shadow-sm">
            <button
              type="button"
              disabled={logoutLoading}
              onClick={handleLogout}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-black/5 dark:active:bg-white/5 disabled:opacity-60"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(255,59,48,0.1)]">
                <LogOut className="h-[18px] w-[18px] text-[#ff3b30]" />
              </span>
              <span className="flex-1 text-[15px] font-medium text-[#ff3b30]">
                {logoutLoading ? "Cerrando sesión…" : "Cerrar sesión de admin"}
              </span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
