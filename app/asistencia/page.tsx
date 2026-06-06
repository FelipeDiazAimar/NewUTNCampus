"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Phone, RefreshCw, WifiOff } from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";

/** Datos de contacto de la facultad (tomados del sistema original). */
const OFICINA_ALUMNOS = {
  titulo: "Oficina de Alumnos",
  telefono: "(03564) 421147 - Interno 117",
  telefonoHref: "tel:+543564421147",
  email: "oficinaalumnos@sanfrancisco.utn.edu.ar",
} as const;

export default function AsistenciaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    // El acceso requiere sesión activa del campus.
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    setReady(true);
  }, [router]);

  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    // Reintento de conexión: vuelve a verificar el acceso recargando la sección.
    // (El sistema real solo permite el ingreso dentro del predio con la red EduRoam.)
    await new Promise((resolve) => setTimeout(resolve, 1200));
    router.refresh();
    setRetrying(false);
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <Navbar />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />

      <main className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-md flex-col px-4 pt-20 pb-12">
        <Breadcrumb
          items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Asistencia" }]}
        />

        <div className="flex flex-1 flex-col items-center justify-center text-center">
          {/* Ícono de estado: red no disponible */}
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-[#ff950015] dark:bg-[#ff9f0a1a]">
            <WifiOff className="h-10 w-10 text-[#ff9500] dark:text-[#ff9f0a]" strokeWidth={1.75} />
          </div>

          {/* Mensaje principal */}
          <h1 className="text-2xl font-semibold text-[var(--fg)]">Acceso Restringido</h1>
          <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-[var(--secondary)]">
            Para acceder a este sitio web debes estar conectado a la red Wi-Fi EduRoam de la
            facultad.
          </p>

          {/* Tarjeta de contacto estilo listado iOS */}
          <div className="mt-8 w-full overflow-hidden rounded-2xl border border-[var(--navbar-border)] bg-[var(--surface)] text-left shadow-sm">
            <div className="px-4 pt-4 pb-2">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--secondary)]">
                {OFICINA_ALUMNOS.titulo}
              </p>
            </div>

            <a
              href={OFICINA_ALUMNOS.telefonoHref}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[rgba(0,0,0,0.04)] active:bg-[rgba(0,0,0,0.06)] dark:hover:bg-[rgba(255,255,255,0.06)]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#34c75915] text-[#34c759] dark:bg-[#30d15815]">
                <Phone className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] text-[var(--secondary)]">Teléfono</span>
                <span className="block truncate text-[15px] text-[var(--fg)]">
                  {OFICINA_ALUMNOS.telefono}
                </span>
              </span>
            </a>

            <div className="mx-4 h-px bg-[var(--separator)]" />

            <a
              href={`mailto:${OFICINA_ALUMNOS.email}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[rgba(0,0,0,0.04)] active:bg-[rgba(0,0,0,0.06)] dark:hover:bg-[rgba(255,255,255,0.06)]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#007aff15] text-[#007aff] dark:bg-[#0a84ff15] dark:text-[#0a84ff]">
                <Mail className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] text-[var(--secondary)]">Email</span>
                <span className="block truncate text-[15px] text-[var(--fg)]">
                  {OFICINA_ALUMNOS.email}
                </span>
              </span>
            </a>
          </div>

          {/* Acción primaria: reintentar la conexión (equivalente al "Reintentar ingreso" original) */}
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-3 font-medium text-white transition-opacity active:opacity-80 disabled:opacity-60"
          >
            {retrying ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Comprobando conexión…
              </>
            ) : (
              "Reintentar conexión"
            )}
          </button>

          <p className="mt-4 text-[12px] leading-relaxed text-[var(--secondary)]">
            El acceso es exclusivo dentro del predio de la UTN San Francisco con la conectividad de
            la institución.
          </p>
        </div>
      </main>
    </div>
  );
}
