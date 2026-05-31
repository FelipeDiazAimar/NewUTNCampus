"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { SpinnerBlock } from "@/components/Spinner";
import { useCourses } from "@/lib/hooks";

type Profile = {
  telegram_chat_id: string | null;
  telegram_link_code: string | null;
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
      onClick={() => !disabled && onChange(!checked)}
      className={`relative w-12 h-7 rounded-full overflow-hidden transition-colors ${
        checked ? "bg-[#34c759]" : "bg-[var(--surface2)]"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function NotificacionesPage() {
  const router = useRouter();
  const { courses, loading: loadingCourses } = useCourses();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [materias, setMaterias] = useState<MateriaConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  const courseNames = useMemo(
    () => courses.map((course) => course.fullname),
    [courses]
  );

  async function loadProfile() {
    setLoading(true);
    const res = await fetch("/api/notifications", { cache: "no-store" });
    if (res.status === 404) {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "init", courses: courseNames }),
      });
      const retry = await fetch("/api/notifications", { cache: "no-store" });
      const data = await retry.json();
      setProfile(data.profile);
      setMaterias(data.materias ?? []);
      setLoading(false);
      return;
    }

    const data = await res.json();
    setProfile(data.profile);
    setMaterias(data.materias ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    if (!loadingCourses) {
      loadProfile();
    }
  }, [loadingCourses, courseNames.length, router]);

  async function updateProfile(next: Partial<Profile>) {
    setProfile((prev) => (prev ? { ...prev, ...next } : prev));
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateProfile", profile: next }),
    });
  }

  async function updateMateria(name: string, patch: Partial<MateriaConfig>) {
    setMaterias((prev) =>
      prev.map((m) => (m.materia_nombre === name ? { ...m, ...patch } : m))
    );
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "updateMateria",
        materia: { materia_nombre: name, ...patch },
      }),
    });
  }

  async function handleLinkTelegram() {
    const res = await fetch("/api/telegram/link", { method: "POST" });
    const data = await res.json();
    setLinkUrl(data.url ?? null);
  }

  const globalActive = profile?.notificaciones_globales_activas ?? true;

  if (loading || loadingCourses) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <Navbar />
        <div className="max-w-xl mx-auto px-4 pt-20">
          <SpinnerBlock label="Cargando configuracion..." />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />

      <main className="max-w-xl mx-auto px-4 pt-20 pb-10">
        <div className="mb-6">
          <h1 className="text-[28px] font-bold text-[var(--fg)] tracking-tight">
            Notificaciones
          </h1>
          <p className="text-[14px] text-[var(--secondary)] mt-1">
            Personaliza como queres recibir avisos por Telegram.
          </p>
        </div>

        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] p-4 shadow-sm mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[15px] font-semibold text-[var(--fg)]">
                Notificaciones Globales
              </p>
              <p className="text-[12px] text-[var(--secondary)]">
                Habilita o pausa todas las materias.
              </p>
            </div>
            <Toggle
              checked={globalActive}
              onChange={async (next) => {
                await updateProfile({ notificaciones_globales_activas: next });
                if (next) {
                  await Promise.all(
                    materias.map((materia) =>
                      updateMateria(materia.materia_nombre, { materia_activa: true })
                    )
                  );
                }
              }}
            />
          </div>

          <div className="mt-4 rounded-xl bg-[var(--surface2)] p-3">
            <p className="text-[13px] font-medium text-[var(--fg)]">
              Telegram
            </p>
            <p className="text-[12px] text-[var(--secondary)] mt-1">
              Vincula tu cuenta para recibir mensajes.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {profile?.telegram_chat_id ? (
                <span className="text-[12px] text-[var(--secondary)]">
                  Cuenta vinculada: {profile.telegram_chat_id}
                </span>
              ) : (
                <span className="text-[12px] text-[var(--secondary)]">
                  Sin cuenta vinculada.
                </span>
              )}
              <button
                type="button"
                className="self-start rounded-xl bg-[#007aff] px-4 py-2 text-[13px] font-semibold text-white"
                onClick={handleLinkTelegram}
              >
                Generar enlace de Telegram
              </button>
              {linkUrl && (
                <a
                  href={linkUrl}
                  className="text-[12px] text-[var(--accent)] underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir bot para vincular
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {materias.map((materia) => {
            const materiaActive = globalActive && materia.materia_activa;
            return (
              <div
                key={materia.materia_nombre}
                className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[15px] font-semibold text-[var(--fg)]">
                      {materia.materia_nombre}
                    </p>
                    <p className="text-[12px] text-[var(--secondary)]">
                      Controla los avisos de esta materia.
                    </p>
                  </div>
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

                <div className={`mt-4 space-y-3 ${materiaActive ? "" : "opacity-50"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[var(--fg)]">Nuevas tareas</span>
                    <Toggle
                      checked={materia.notificar_nuevas}
                      disabled={!materiaActive}
                      onChange={(next) => updateMateria(materia.materia_nombre, { notificar_nuevas: next })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[var(--fg)]">Cierre de tareas</span>
                    <Toggle
                      checked={materia.notificar_cierre}
                      disabled={!materiaActive}
                      onChange={(next) => updateMateria(materia.materia_nombre, { notificar_cierre: next })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[var(--fg)]">Aviso de vencimiento</span>
                    <Toggle
                      checked={materia.notificar_vencimiento}
                      disabled={!materiaActive}
                      onChange={(next) => updateMateria(materia.materia_nombre, { notificar_vencimiento: next })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[var(--fg)]">Dias de anticipacion</span>
                    <input
                      type="number"
                      min={0}
                      className="w-16 rounded-lg border border-[var(--separator)] bg-transparent px-2 py-1 text-[13px] text-[var(--fg)]"
                      value={materia.dias_anticipacion_vencimiento}
                      disabled={!materiaActive}
                      onChange={(event) =>
                        updateMateria(materia.materia_nombre, {
                          dias_anticipacion_vencimiento: Number(event.target.value),
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
