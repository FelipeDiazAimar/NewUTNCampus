"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import useSWR from "swr";
import {
  Check,
  ChevronRight,
  Laptop,
  LogOut,
  Monitor,
  Moon,
  Smartphone,
  Sparkles,
  Sun,
  Tablet,
  Wrench,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
import { clearCourseCache } from "@/lib/hooks";

const ADMIN_TOKEN = "campus-admin-2024-internal";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type DeviceSession = {
  deviceId: string;
  userAgent: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  current: boolean;
};

// ─── Helpers de presentación ──────────────────────────────────────────────────

function deviceLabel(ua: string | null): { name: string; Icon: typeof Smartphone } {
  if (!ua) return { name: "Dispositivo desconocido", Icon: Monitor };
  const isTablet = /iPad|Tablet/i.test(ua);
  const isPhone = /Mobile|Android|iPhone|iPod/i.test(ua) && !isTablet;
  const Icon = isTablet ? Tablet : isPhone ? Smartphone : Laptop;

  const os = /iPhone|iPad|iPod/i.test(ua)
    ? "iOS"
    : /Android/i.test(ua)
    ? "Android"
    : /Windows/i.test(ua)
    ? "Windows"
    : /Mac OS X|Macintosh/i.test(ua)
    ? "macOS"
    : /Linux/i.test(ua)
    ? "Linux"
    : "";

  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
    ? "Opera"
    : /Chrome\//i.test(ua)
    ? "Chrome"
    : /Firefox\//i.test(ua)
    ? "Firefox"
    : /Safari\//i.test(ua)
    ? "Safari"
    : "Navegador";

  const name = os ? `${browser} en ${os}` : browser;
  return { name, Icon };
}

function relativeTime(value: string | null): string {
  if (!value) return "Sin registro";
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return "Sin registro";
  const mins = Math.max(0, Math.round(diff / 60000));
  if (mins < 1) return "Activo ahora";
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.round(hrs / 24);
  return `Hace ${days} ${days === 1 ? "día" : "días"}`;
}

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { sessions: [] }));

// ─── Página ───────────────────────────────────────────────────────────────────

export default function ConfiguracionPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null); // deviceId | "others"

  useEffect(() => {
    setMounted(true);
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    setIsAdmin(document.cookie.includes(`admin_session_token=${ADMIN_TOKEN}`));
  }, [router]);

  const { data, isLoading, mutate } = useSWR<{ sessions: DeviceSession[] }>("/api/sessions", fetcher, {
    revalidateOnFocus: false,
  });
  const sessions = data?.sessions ?? [];
  const otherSessions = sessions.filter((s) => !s.current);

  async function logoutCurrent() {
    setLoggingOut(true);
    await Promise.all([
      fetch("/api/auth", { method: "DELETE" }),
      fetch("/api/sysacadws/login", { method: "DELETE" }),
    ]).catch(() => {});
    clearCourseCache();
    router.push("/");
  }

  const revoke = useCallback(
    async (target: { deviceId?: string }) => {
      const key = target.deviceId ?? "others";
      setRevoking(key);
      try {
        await fetch("/api/sessions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(target.deviceId ? { deviceId: target.deviceId } : { scope: "others" }),
        });
        await mutate();
      } finally {
        setRevoking(null);
      }
    },
    [mutate]
  );

  const themeOptions: { value: string; label: string; desc: string; Icon: typeof Sun }[] = [
    { value: "system", label: "Automático", desc: "Sigue el modo del sistema", Icon: Monitor },
    { value: "light", label: "Siempre claro", desc: "Fondo blanco en todo momento", Icon: Sun },
    { value: "dark", label: "Siempre oscuro", desc: "Fondo oscuro en todo momento", Icon: Moon },
  ];
  const currentTheme = mounted ? theme ?? "system" : "system";

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />

      <main className="mx-auto max-w-xl px-4 pt-12 pb-12">
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Configuración" }]} />

        <div className="mb-6">
          <h1 className="text-[28px] font-bold tracking-tight text-[var(--fg)]">Configuración</h1>
          <p className="mt-1 text-[14px] text-[var(--secondary)]">
            Apariencia, sesiones y preferencias de tu cuenta.
          </p>
        </div>

        {/* ── Apariencia ── */}
        <Section title="Apariencia">
          <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm divide-y divide-[var(--separator)]">
            {themeOptions.map(({ value, label, desc, Icon }) => {
              const active = currentTheme === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-black/5 dark:active:bg-white/5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--surface2)] text-[var(--fg)]">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-medium text-[var(--fg)]">{label}</span>
                    <span className="block text-[12px] text-[var(--secondary)]">{desc}</span>
                  </span>
                  {active && <Check className="h-[18px] w-[18px] shrink-0 text-[#007aff]" />}
                </button>
              );
            })}
          </div>
        </Section>

        {/* ── Sesión en este dispositivo ── */}
        <Section title="Sesión en este dispositivo">
          <div className="overflow-hidden rounded-[20px] border border-[rgba(255,59,48,0.2)] bg-[var(--surface)] shadow-sm">
            <button
              type="button"
              disabled={loggingOut}
              onClick={logoutCurrent}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-black/5 dark:active:bg-white/5 disabled:opacity-60"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(255,59,48,0.1)]">
                <LogOut className="h-[18px] w-[18px] text-[#ff3b30]" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-medium text-[#ff3b30]">
                  {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
                </span>
                <span className="block text-[12px] text-[var(--secondary)]">
                  Cierra tu Campus y tu Sysacad en este dispositivo
                </span>
              </span>
            </button>
          </div>
        </Section>

        {/* ── Otros dispositivos ── */}
        <Section title="Sesiones en otros dispositivos">
          <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm">
            {isLoading ? (
              <SpinnerBlock label="Buscando tus dispositivos…" size={22} minHeight={100} />
            ) : otherSessions.length === 0 ? (
              <p className="px-4 py-6 text-center text-[14px] text-[var(--secondary)]">
                No hay sesiones abiertas en otros dispositivos.
              </p>
            ) : (
              <div className="divide-y divide-[var(--separator)]">
                {otherSessions.map((s) => {
                  const { name, Icon } = deviceLabel(s.userAgent);
                  return (
                    <div key={s.deviceId} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--surface2)] text-[var(--fg)]">
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-[15px] font-medium text-[var(--fg)]">{name}</span>
                        <span className="block text-[12px] text-[var(--secondary)]">{relativeTime(s.lastSeenAt)}</span>
                      </span>
                      <button
                        type="button"
                        disabled={revoking !== null}
                        onClick={() => revoke({ deviceId: s.deviceId })}
                        className="shrink-0 rounded-full border border-[rgba(255,59,48,0.3)] px-3 py-1.5 text-[12px] font-semibold text-[#ff3b30] transition-opacity active:opacity-70 disabled:opacity-40"
                      >
                        {revoking === s.deviceId ? "Cerrando…" : "Cerrar"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {otherSessions.length > 0 && (
            <button
              type="button"
              disabled={revoking !== null}
              onClick={() => revoke({})}
              className="mt-3 w-full rounded-[14px] border border-[rgba(255,59,48,0.3)] bg-[var(--surface)] py-3 text-[14px] font-semibold text-[#ff3b30] shadow-sm transition-opacity active:opacity-80 disabled:opacity-40"
            >
              {revoking === "others" ? "Cerrando sesiones…" : "Cerrar sesión en todos los demás dispositivos"}
            </button>
          )}

          <p className="px-4 mt-2 text-[13px] leading-relaxed text-[var(--secondary)]">
            Al cerrar una sesión, ese dispositivo saldrá del Campus la próxima vez que la app verifique la sesión.
          </p>
        </Section>

        {/* ── Próximamente ── */}
        <Section title="Más opciones">
          <div className="flex items-start gap-3.5 overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] p-4 shadow-sm">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[rgba(0,122,255,0.1)] text-[#007aff] dark:text-[#0a84ff]">
              <Sparkles className="h-[22px] w-[22px]" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-[var(--fg)]">Próximamente</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--secondary)]">
                Estamos trabajando en más configuraciones para personalizar tu experiencia.
              </p>
            </div>
          </div>
        </Section>

        {/* ── Acceso admin (movido desde /notificaciones) ── */}
        {mounted && (
          <section className="mt-8">
            {isAdmin ? (
              <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm">
                <Link
                  href="/admin/dashboard"
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-black/5 dark:active:bg-white/5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(175,82,222,0.12)]">
                    <Wrench className="h-[18px] w-[18px] text-[#af52de]" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-medium text-[var(--fg)]">Panel de administración</span>
                    <span className="block text-[12px] text-[var(--secondary)]">Herramientas internas del equipo</span>
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[var(--secondary)]" />
                </Link>
              </div>
            ) : (
              <Link
                href="/admin/login?next=/admin/dashboard"
                className="flex items-center justify-center gap-2 py-2 text-[12px] text-[var(--secondary)] active:opacity-60"
              >
                <Wrench className="h-3.5 w-3.5" />
                Acceso admin
              </Link>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">{title}</p>
      {children}
    </section>
  );
}
