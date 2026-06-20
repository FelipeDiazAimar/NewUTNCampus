"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { mutate as globalMutate } from "swr";
import { ChevronRight, KeyRound, LogOut } from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import SysacadWsLogin from "@/components/sysacadws/LoginForm";
import ProfileHeader from "@/components/sysacadws/ProfileHeader";
import ResumenHero from "@/components/sysacadws/ResumenHero";
import EgresoCard from "@/components/sysacadws/EgresoCard";
import PlanRoadmap from "@/components/sysacadws/PlanRoadmap";
import EstadisticasCard from "@/components/sysacadws/EstadisticasCard";
import AsistenciaCard from "@/components/sysacadws/AsistenciaCard";
import PlanificacionCard from "@/components/sysacadws/PlanificacionCard";
import AvanceWidget from "@/components/sysacadws/AvanceWidget";
import CursadoWidget from "@/components/sysacadws/CursadoWidget";
import HistorialAcademico from "@/components/sysacadws/HistorialAcademico";
import CorrelatividadesAccordion from "@/components/sysacadws/CorrelatividadesAccordion";
import { useAvance, useCursado, useEstado, useExamenes, usePlan } from "@/lib/sysacadHooks";
import type { SysacadWsUser } from "@/lib/sysacadws";

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

export default function SysacadPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SysacadWsUser | null>(null);

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    setUser(getWsUser());
    setReady(true);
  }, [router]);

  // Datos cacheados con SWR (instantáneos al volver). El WS no expira.
  const legajo = user?.legajo;
  const { data: avance, error: avanceError } = useAvance(legajo);
  const { data: cursado, error: cursadoError } = useCursado(legajo);
  const { data: examenes, error: examenesError } = useExamenes(legajo);
  const { data: plan, error: planError } = usePlan(user?.idEspecialidad, user?.plan);
  const { data: estadoRes, isLoading: estadoLoading } = useEstado(legajo);
  const estado = estadoRes?.data ?? [];

  // Si algún dato del WS responde 401, la sesión de Sysacad ya no sirve →
  // pedimos re-login (en vez de quedar cargando para siempre).
  const sessionExpired = [avanceError, cursadoError, examenesError, planError].some(
    (e) => (e as { status?: number } | undefined)?.status === 401
  );

  const coreLoading = !!user && !sessionExpired && (!avance || !cursado || !examenes || !plan);

  function handleLoginSuccess() {
    setUser(getWsUser());
    // Revalida los datos del WS (limpia errores 401 cacheados de una sesión vencida).
    globalMutate(() => true);
    const next = new URLSearchParams(window.location.search).get("next");
    if (next) router.replace(next);
  }

  async function handleLogout() {
    await fetch("/api/sysacadws/login", { method: "DELETE" });
    setUser(null);
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
      <main className="max-w-2xl mx-auto px-4 pt-12 pb-12">
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sysacad" }]} />

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
            <ProfileHeader user={user} />

            <ResumenHero
              loading={coreLoading || estadoLoading}
              estado={estado}
              examenes={examenes?.Examenes ?? []}
              plan={plan ?? null}
              avance={avance ?? null}
              cursado={cursado ?? null}
            />

            {!coreLoading && (
              <>
                <EgresoCard estado={estado} plan={plan!} avance={avance!} />
                <PlanRoadmap estado={estado} cursado={cursado!} plan={plan!} legajo={legajo} />
                <AsistenciaCard
                  cursado={cursado!}
                  plan={plan!}
                  especialidad={user.especialidad}
                  legajo={legajo}
                />
                <PlanificacionCard estado={estado} cursado={cursado!} legajo={legajo} />
                <EstadisticasCard examenes={examenes!.Examenes ?? []} />
                <AvanceWidget avance={avance!} examenes={examenes!.Examenes ?? []} estado={estado} estadoLoading={estadoLoading} />
                <CursadoWidget cursado={cursado!} />
                <HistorialAcademico
                  estado={estado}
                  examenes={examenes!.Examenes ?? []}
                  planMaterias={plan!.Materias ?? []}
                />
                <CorrelatividadesAccordion legajo={legajo} />

                <Link
                  href="/dashboard/sysacad/password"
                  className="flex items-center gap-3 px-5 py-3.5 rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] backdrop-blur-md shadow-sm active:bg-[var(--surface2)]"
                >
                  <KeyRound className="w-[18px] h-[18px] text-[#8e8e93]" />
                  <span className="flex-1 text-[15px] font-medium text-[var(--fg)]">Cambiar contraseña</span>
                  <ChevronRight className="w-4 h-4 text-[var(--secondary)]" />
                </Link>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full py-3.5 rounded-2xl bg-[var(--surface)] border border-[var(--separator)] text-[#ff3b30] font-semibold text-[15px] active:opacity-80 transition-opacity shadow-sm flex items-center justify-center gap-2"
                >
                  <LogOut className="w-[18px] h-[18px]" />
                  Salir de Sysacad
                </button>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
