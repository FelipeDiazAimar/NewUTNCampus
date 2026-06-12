"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, ChevronDown, Share, Smartphone, Wrench, ChevronRight } from "lucide-react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import Spinner, { SpinnerBlock } from "@/components/Spinner";
import { useCourses } from "@/lib/hooks";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Profile = {
  notificaciones_globales_activas: boolean;
};

type MateriaConfig = {
  materia_nombre: string;
  materia_activa: boolean;
  notificar_nuevas: boolean;
  notificar_cierre: boolean;
  notificar_vencimiento: boolean;
  dias_anticipacion_vencimiento: number;
};

// ─── Helper VAPID ─────────────────────────────────────────────────────────────

/** Convierte la clave VAPID pública (base64url) al Uint8Array que pide la Push API. */
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ─── Toggle estilo iOS ────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full p-[2px] transition-colors duration-300 ease-out ${
        checked ? "bg-[#34c759]" : "bg-[rgba(120,120,128,0.32)]"
      } ${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}
    >
      <span
        className={`h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-out ${
          checked ? "translate-x-[20px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ─── Push notifications (control principal) ───────────────────────────────────

type PushPhase = "loading" | "ready";

function usePushSubscription() {
  const [phase, setPhase] = useState<PushPhase>("loading");
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Estado inicial: soporte + suscripción existente.
  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        typeof Notification === "undefined"
      ) {
        if (!cancelled) { setSupported(false); setPhase("ready"); }
        return;
      }

      setSupported(true);
      setPermission(Notification.permission);

      try {
        // Registramos (idempotente) y esperamos a que el SW esté activo.
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscription(sub);
      } catch {
        if (!cancelled) setMessage("No se pudo inicializar el servicio de notificaciones.");
      } finally {
        if (!cancelled) setPhase("ready");
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  const enable = useCallback(async () => {
    setMessage(null);
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      setMessage("Falta configurar la clave de notificaciones (VAPID).");
      return;
    }

    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        if (perm === "denied") {
          setMessage("Bloqueaste las notificaciones. Habilitalas desde los ajustes del navegador.");
        }
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch("/api/notifications/push-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!res.ok) throw new Error("save");

      setSubscription(sub);
    } catch {
      setMessage("No se pudo activar las notificaciones. Intentá de nuevo.");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    if (!subscription) return;
    setMessage(null);
    setBusy(true);
    try {
      await fetch("/api/notifications/push-subscription", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      setSubscription(null);
    } catch {
      setMessage("No se pudo desactivar las notificaciones.");
    } finally {
      setBusy(false);
    }
  }, [subscription]);

  return { phase, supported, permission, subscription, busy, message, enable, disable };
}

function PushSection() {
  const { phase, supported, permission, subscription, busy, message, enable, disable } = usePushSubscription();

  const active = !!subscription;
  const denied = permission === "denied";
  const disabled = !supported || denied || busy || phase === "loading";

  const helper = (() => {
    if (message) return message;
    if (!supported) return "Tu navegador no es compatible con las notificaciones push.";
    if (denied) return "Bloqueaste las notificaciones. Habilitalas desde los ajustes de tu navegador o dispositivo.";
    if (active) return "Vas a recibir alertas en este dispositivo, incluso con la app cerrada.";
    return "Activá para recibir avisos de tareas y novedades aunque no tengas la app abierta.";
  })();

  return (
    <section className="mb-7">
      <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
        Notificaciones en este dispositivo
      </p>

      <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: active ? "rgba(52,199,89,0.16)" : "var(--surface2)", color: active ? "#34c759" : "var(--secondary)" }}
          >
            {active ? <Bell className="h-[18px] w-[18px]" /> : <BellOff className="h-[18px] w-[18px]" />}
          </span>
          <span className="flex-1 text-[16px] font-medium text-[var(--fg)]">Notificaciones push</span>
          {phase === "loading" ? (
            <Spinner size={22} />
          ) : (
            <Toggle
              checked={active}
              disabled={disabled}
              onChange={(next) => (next ? enable() : disable())}
            />
          )}
        </div>
      </div>

      <p className={`px-4 mt-2 text-[13px] leading-relaxed ${denied || (!supported && phase === "ready") ? "text-[#ff9500]" : "text-[var(--secondary)]"}`}>
        {phase === "loading" ? "Comprobando el estado de las notificaciones…" : helper}
      </p>
    </section>
  );
}

// ─── Tarjeta de onboarding (instalar PWA) ─────────────────────────────────────

function InstallCard() {
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(!!standalone);
  }, []);

  if (installed) return null;

  return (
    <section className="mb-7">
      <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#007aff1a] text-[#007aff] dark:text-[#0a84ff]">
            <Smartphone className="h-[22px] w-[22px]" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[var(--fg)]">Instalá la app</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--secondary)]">
              Para una experiencia completa y recibir alertas en segundo plano, instalá esta app:
              en iOS tocá{" "}
              <span className="inline-flex items-center gap-0.5 font-medium text-[var(--fg)]">
                Compartir <Share className="inline h-3.5 w-3.5" />
              </span>{" "}
              y luego <span className="font-medium text-[var(--fg)]">«Agregar a la pantalla de inicio»</span>; en
              Android, <span className="font-medium text-[var(--fg)]">«Instalar aplicación»</span>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

const ADMIN_TOKEN = "campus-admin-2024-internal";

export default function NotificacionesPage() {
  const router = useRouter();
  const { courses, loading: loadingCourses } = useCourses();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [materias, setMaterias] = useState<MateriaConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openMaterias, setOpenMaterias] = useState<Record<string, boolean>>({});
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setIsAdmin(document.cookie.includes(`admin_session_token=${ADMIN_TOKEN}`));
  }, []);

  const courseNames = useMemo(() => courses.map((c) => c.fullname), [courses]);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok && res.status !== 404) throw new Error();

      if (res.status === 404) {
        await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "init", courses: courseNames }),
        });
        const retry = await fetch("/api/notifications", { cache: "no-store" });
        if (!retry.ok) throw new Error();
        const data = await retry.json();
        setProfile(data.profile);
        setMaterias(data.materias ?? []);
        return;
      }

      const data = await res.json();
      setProfile(data.profile);
      const existing = data.materias ?? [];

      if (existing.length === 0 && courseNames.length > 0) {
        const seeded = await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "init", courses: courseNames }),
        });
        if (!seeded.ok) throw new Error();
        const seededData = await seeded.json();
        setProfile(seededData.profile ?? data.profile);
        setMaterias(seededData.materias ?? []);
        return;
      }

      setMaterias(existing);
    } catch {
      setError("No se pudieron cargar las preferencias de notificación.");
    } finally {
      setLoading(false);
    }
  }, [courseNames]);

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    if (!loadingCourses) loadProfile();
  }, [loadingCourses, loadProfile, router]);

  async function updateProfile(next: Partial<Profile>) {
    setProfile((prev) => (prev ? { ...prev, ...next } : prev));
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateProfile", profile: next }),
    });
  }

  async function updateMateria(name: string, patch: Partial<MateriaConfig>) {
    setMaterias((prev) => prev.map((m) => (m.materia_nombre === name ? { ...m, ...patch } : m)));
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateMateria", materia: { materia_nombre: name, ...patch } }),
    });
  }

  const globalActive = profile?.notificaciones_globales_activas ?? true;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />

      <main className="mx-auto max-w-xl px-4 pt-20 pb-12">
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Notificaciones" }]} />

        <div className="mb-6">
          <h1 className="text-[28px] font-bold tracking-tight text-[var(--fg)]">Notificaciones</h1>
          <p className="mt-1 text-[14px] text-[var(--secondary)]">
            Recibí avisos de tus tareas directamente en tu dispositivo.
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-[20px] border border-[#ffcdd2] bg-[#fff2f2] p-4 text-sm text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]">
            {error}
          </div>
        )}

        {/* Onboarding PWA + control principal de Web Push */}
        <InstallCard />
        <PushSection />

        {/* Preferencias de contenido (qué avisar) */}
        <section>
          <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
            Preferencias
          </p>

          {loading || loadingCourses ? (
            <div className="rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm">
              <SpinnerBlock label="Cargando preferencias…" size={24} minHeight={120} />
            </div>
          ) : (
            <>
              {/* Master switch */}
              <div className="mb-5 overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm">
                <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <p className="text-[16px] font-medium text-[var(--fg)]">Avisos activos</p>
                    <p className="text-[12px] text-[var(--secondary)]">Pausá o reactivá todas las materias.</p>
                  </div>
                  <Toggle
                    checked={globalActive}
                    onChange={async (next) => {
                      await updateProfile({ notificaciones_globales_activas: next });
                      if (next) {
                        await Promise.all(
                          materias.map((m) => updateMateria(m.materia_nombre, { materia_activa: true }))
                        );
                      }
                    }}
                  />
                </div>
              </div>

              {/* Materias */}
              {materias.length > 0 ? (
                <div className="space-y-4">
                  {materias.map((materia) => {
                    const materiaActive = globalActive && materia.materia_activa;
                    const isOpen = openMaterias[materia.materia_nombre] ?? false;
                    const toggleOpen = () =>
                      setOpenMaterias((prev) => ({ ...prev, [materia.materia_nombre]: !isOpen }));

                    return (
                      <div
                        key={materia.materia_nombre}
                        className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm"
                      >
                        <div className="flex items-center gap-3 px-4 py-3.5">
                          <button type="button" onClick={toggleOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left active:opacity-70">
                            <ChevronDown
                              className={`h-4 w-4 shrink-0 text-[var(--secondary)] transition-transform ${isOpen ? "rotate-180" : ""}`}
                            />
                            <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-[var(--fg)]">
                              {materia.materia_nombre}
                            </span>
                          </button>
                          <Toggle
                            checked={materia.materia_activa}
                            disabled={!globalActive}
                            onChange={(next) => {
                              const patch: Partial<MateriaConfig> = { materia_activa: next };
                              if (next) {
                                patch.notificar_nuevas = true;
                                patch.notificar_cierre = true;
                                patch.notificar_vencimiento = true;
                                patch.dias_anticipacion_vencimiento = 1;
                              }
                              updateMateria(materia.materia_nombre, patch);
                            }}
                          />
                        </div>

                        {isOpen && (
                          <div className={`divide-y divide-[var(--separator)] border-t border-[var(--separator)] ${materiaActive ? "" : "opacity-50"}`}>
                            <Row label="Nuevas tareas">
                              <Toggle
                                checked={materia.notificar_nuevas}
                                disabled={!materiaActive}
                                onChange={(next) => updateMateria(materia.materia_nombre, { notificar_nuevas: next })}
                              />
                            </Row>
                            <Row label="Cierre de tareas">
                              <Toggle
                                checked={materia.notificar_cierre}
                                disabled={!materiaActive}
                                onChange={(next) => updateMateria(materia.materia_nombre, { notificar_cierre: next })}
                              />
                            </Row>
                            <Row label="Aviso de vencimiento">
                              <Toggle
                                checked={materia.notificar_vencimiento}
                                disabled={!materiaActive}
                                onChange={(next) => updateMateria(materia.materia_nombre, { notificar_vencimiento: next })}
                              />
                            </Row>
                            <Row label="Días de anticipación">
                              <input
                                type="number"
                                min={0}
                                className="w-16 rounded-lg border border-[var(--separator)] bg-transparent px-2 py-1 text-right text-[15px] text-[var(--fg)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
                                value={materia.dias_anticipacion_vencimiento}
                                disabled={!materiaActive}
                                onChange={(e) =>
                                  updateMateria(materia.materia_nombre, {
                                    dias_anticipacion_vencimiento: Number(e.target.value),
                                  })
                                }
                              />
                            </Row>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] px-4 py-8 text-center shadow-sm">
                  <p className="text-[14px] text-[var(--secondary)]">No hay materias para configurar todavía.</p>
                </div>
              )}
            </>
          )}
        </section>

        {/* Acceso rápido al login de admin — visible siempre, borrar cuando no se necesite */}
        {!isAdmin && (
          <section className="mt-8">
            <Link
              href="/admin/login"
              className="flex items-center justify-center gap-2 py-2 text-[12px] text-[var(--secondary)] active:opacity-60"
            >
              <Wrench className="h-3.5 w-3.5" />
              Acceso admin
            </Link>
          </section>
        )}

        {/* Herramientas de Desarrollador — solo visible para el admin */}
        {isAdmin && (
          <section className="mt-8">
            <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
              Herramientas de Desarrollador
            </p>
            <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm">
              <Link
                href="/admin"
                className="flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-black/5 dark:active:bg-white/5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(175,82,222,0.12)]">
                  <Wrench className="h-[18px] w-[18px] text-[#af52de]" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-medium text-[var(--fg)]">Panel de Pruebas PWA</span>
                  <span className="block text-[12px] text-[var(--secondary)]">Simulador de eventos de notificaciones</span>
                </span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[var(--secondary)]" />
              </Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

// ─── Fila de opción (label izquierda, control derecha) ────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-[15px] text-[var(--fg)]">{label}</span>
      {children}
    </div>
  );
}
