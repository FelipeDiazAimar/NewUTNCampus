"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, KeyRound, LogOut } from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
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
  const { data: avance } = useAvance(legajo);
  const { data: cursado } = useCursado(legajo);
  const { data: examenes } = useExamenes(legajo);
  const { data: plan } = usePlan(user?.idEspecialidad, user?.plan);
  const { data: estadoRes, isLoading: estadoLoading } = useEstado(legajo);
  const estado = estadoRes?.data ?? [];

  const coreLoading = !!user && (!avance || !cursado || !examenes || !plan);

  function handleLoginSuccess() {
    setUser(getWsUser());
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

        {!user ? (
          <div className="flex flex-col items-center pt-6">
            <SysacadWsLogin onSuccess={handleLoginSuccess} />
          </div>
        ) : (
          <div className="space-y-4">
            <ProfileHeader user={user} />

            {coreLoading && <SpinnerBlock label="Cargando tus datos…" />}

            {!coreLoading && (
              <>
                <ResumenHero
                  estado={estado}
                  examenes={examenes!.Examenes ?? []}
                  plan={plan!}
                  avance={avance!}
                  cursado={cursado!}
                />
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
