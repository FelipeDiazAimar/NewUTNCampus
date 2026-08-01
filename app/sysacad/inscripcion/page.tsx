"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import SysacadWsLogin from "@/components/sysacadws/LoginForm";
import MateriaInscripcionItem from "@/components/sysacadws/MateriaInscripcionItem";
import { useMateriasParaCursado, postInscribir, postDesinscribir } from "@/lib/sysacadHooks";
import { isGuestMode, triggerGuestBlock } from "@/lib/guest";
import type { SysacadWsUser, SysacadMateriaParaCursado } from "@/lib/sysacadws";

function getWsUser(): SysacadWsUser | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/sysacadws_user=([^;]+)/);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1])) as SysacadWsUser;
  } catch {
    return null;
  }
}

export default function InscripcionPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SysacadWsUser | null>(null);
  const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    setUser(getWsUser());
    setReady(true);
  }, [router]);

  const legajo = user?.legajo;
  const { data, error, isLoading } = useMateriasParaCursado(legajo);
  const sessionExpired = (error as { status?: number } | undefined)?.status === 401;

  const materiasKey = legajo ? `/api/sysacadws/cursado/materiasparacursado/${legajo}` : null;

  async function handleInscribir(materia: SysacadMateriaParaCursado, comision: string) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
    if (!legajo) return;
    setBanner(null);
    const r = await postInscribir(legajo, materia, comision);
    if (r.ok) {
      setBanner({ tone: "ok", text: `Te inscribiste a ${materia.NombreMateria}.` });
      if (materiasKey) globalMutate(materiasKey);
    } else {
      setBanner({ tone: "error", text: r.motivo });
    }
  }

  async function handleDesinscribir(materia: SysacadMateriaParaCursado) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
    if (!legajo) return;
    setBanner(null);
    const r = await postDesinscribir(legajo, materia);
    if (r.ok) {
      setBanner({ tone: "ok", text: `Te desinscribiste de ${materia.NombreMateria}.` });
      if (materiasKey) globalMutate(materiasKey);
    } else {
      setBanner({ tone: "error", text: r.motivo });
    }
  }

  function handleLoginSuccess() {
    setUser(getWsUser());
    globalMutate(() => true);
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <Navbar />
      </div>
    );
  }

  const materias = data?.Materias ?? [];
  const inscriptas = materias.filter((m) => m.Comision !== "0");
  const disponibles = materias.filter((m) => m.Comision === "0");

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 pb-12 pt-12">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Sysacad", href: "/sysacad" },
            { label: "Inscripción" },
          ]}
        />

        {!user || sessionExpired ? (
          <div className="flex flex-col items-center pt-6">
            {sessionExpired && (
              <div className="mb-4 w-full max-w-sm rounded-2xl border border-[#ffe0b2] bg-[#fff8f0] px-4 py-3 text-center text-[13px] text-[#ff9500] dark:border-[rgba(255,149,0,0.25)] dark:bg-[rgba(255,149,0,0.08)]">
                Tu sesión de Sysacad expiró. Volvé a iniciar sesión para ver tus datos.
              </div>
            )}
            <SysacadWsLogin onSuccess={handleLoginSuccess} />
          </div>
        ) : (
          <div className="space-y-4">
            {banner && (
              <div
                className={
                  banner.tone === "ok"
                    ? "rounded-2xl border border-[#34c75933] bg-[#34c7590d] px-4 py-3 text-[13px] font-medium text-[#34c759]"
                    : "rounded-2xl border border-[#ffcdd2] bg-[#fff2f2] px-4 py-3 text-[13px] font-medium text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]"
                }
              >
                {banner.text}
              </div>
            )}

            {isLoading && (
              <p className="py-8 text-center text-[14px] text-[var(--secondary)]">Cargando materias…</p>
            )}

            {!isLoading && error && !sessionExpired && (
              <p className="py-8 text-center text-[14px] text-[var(--secondary)]">
                No se pudieron cargar las materias. Reintentá en unos minutos.
              </p>
            )}

            {!isLoading && !error && materias.length === 0 && (
              <p className="py-8 text-center text-[14px] text-[var(--secondary)]">
                No hay materias para cursado en este momento.
              </p>
            )}

            {!isLoading && inscriptas.length > 0 && (
              <section>
                <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Inscripto
                </p>
                <div className="space-y-2.5">
                  {inscriptas.map((m) => (
                    <MateriaInscripcionItem
                      key={m.IdMateria}
                      legajo={legajo!}
                      materia={m}
                      mode="inscripta"
                      onInscribir={handleInscribir}
                      onDesinscribir={handleDesinscribir}
                    />
                  ))}
                </div>
              </section>
            )}

            {!isLoading && disponibles.length > 0 && (
              <section>
                <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Podés inscribirte
                </p>
                <div className="space-y-2.5">
                  {disponibles.map((m) => (
                    <MateriaInscripcionItem
                      key={m.IdMateria}
                      legajo={legajo!}
                      materia={m}
                      mode="disponible"
                      onInscribir={handleInscribir}
                      onDesinscribir={handleDesinscribir}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
