"use client";

import { use, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  ClipboardList,
  ExternalLink,
  GitBranch,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
import { useSysacadData } from "@/lib/hooks";
import type {
  SysacadRecurso,
  MateriaEstado,
  MateriaCorrelativa,
  MateriaPlan,
  MateriaCursando,
} from "@/lib/sysacad";

const CONFIG: Record<
  SysacadRecurso,
  { title: string; icon: LucideIcon; tone: string; groupByNivel: boolean }
> = {
  notas: { title: "Notas de parciales", icon: ListChecks, tone: "#007aff", groupByNivel: false },
  estado: { title: "Estado académico", icon: ClipboardList, tone: "#34c759", groupByNivel: true },
  materias: { title: "Materias del plan", icon: BookOpen, tone: "#ff9500", groupByNivel: true },
  correlatividades: { title: "Correlatividades", icon: GitBranch, tone: "#af52de", groupByNivel: true },
};

const VALID = Object.keys(CONFIG) as SysacadRecurso[];

/** Píldora de estado reutilizable. */
function Pill({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ backgroundColor: `${tone}1a`, color: tone }}
    >
      {text}
    </span>
  );
}

/** Color de estado para una materia de "estado académico". */
function estadoTone(estado: string): string {
  const e = estado.toLowerCase();
  if (e.startsWith("aprobada")) return "#34c759";
  if (e.includes("cursa")) return "#007aff";
  return "#8e8e93";
}

export default function SysacadRecursoPage({
  params,
}: {
  params: Promise<{ recurso: string }>;
}) {
  const { recurso } = use(params);
  const router = useRouter();
  const valid = VALID.includes(recurso as SysacadRecurso);
  const cfg = valid ? CONFIG[recurso as SysacadRecurso] : null;

  const { data, alumno, loading, error, expired } = useSysacadData(
    (valid ? recurso : "estado") as SysacadRecurso
  );

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) router.push("/");
  }, [router]);

  // Sesión Sysacad expirada → volver al login de Sysacad.
  useEffect(() => {
    if (expired) router.push("/dashboard/sysacad");
  }, [expired, router]);

  // Agrupar por nivel (estado, materias, correlatividades) preservando el orden.
  const grupos = useMemo(() => {
    if (!cfg?.groupByNivel) return null;
    const map = new Map<string, typeof data>();
    for (const item of data) {
      const nivel = (item as { nivel: string }).nivel || "—";
      if (!map.has(nivel)) map.set(nivel, []);
      (map.get(nivel) as unknown[]).push(item);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }));
  }, [data, cfg]);

  if (!valid) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <Navbar />
        <main className="max-w-xl mx-auto px-4 pt-24 text-center">
          <p className="text-[var(--secondary)]">Recurso no encontrado.</p>
          <Link href="/dashboard/sysacad" className="text-[#007aff] font-semibold mt-2 inline-block">
            Volver a Sysacad
          </Link>
        </main>
      </div>
    );
  }

  const Icon = cfg!.icon;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />

      <main className="max-w-xl mx-auto px-4 pt-20 pb-12">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Sysacad", href: "/dashboard/sysacad" },
            { label: cfg!.title },
          ]}
        />

        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm"
            style={{ backgroundColor: `${cfg!.tone}1a`, color: cfg!.tone }}
          >
            <Icon className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold text-[var(--fg)] tracking-tight leading-tight">
              {cfg!.title}
            </h1>
            {alumno && <p className="text-[13px] text-[var(--secondary)] truncate">{alumno}</p>}
          </div>
        </div>

        {loading && <SpinnerBlock label="Consultando Sysacad…" />}

        {!loading && error && (
          <div className="rounded-2xl border border-[#ffcdd2] bg-[#fff2f2] p-4 text-sm text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]">
            {error}
          </div>
        )}

        {!loading && !error && data.length === 0 && (
          <div className="rounded-2xl border border-[var(--separator)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--secondary)] shadow-sm">
            No hay información para mostrar.
          </div>
        )}

        {/* Vistas agrupadas por nivel */}
        {!loading && !error && cfg!.groupByNivel && grupos && (
          <div className="space-y-6">
            {grupos.map(([nivel, items]) => (
              <section key={nivel}>
                <p className="px-1 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Nivel {nivel}
                </p>
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] overflow-hidden shadow-sm">
                  {items.map((item, i) => (
                    <div
                      key={`${nivel}-${i}`}
                      className={`flex items-center gap-3 px-4 py-3 ${
                        i < items.length - 1 ? "border-b border-[var(--separator)]" : ""
                      }`}
                    >
                      {recurso === "estado" &&
                        (() => {
                          const m = item as MateriaEstado;
                          return (
                            <>
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: estadoTone(m.estado) }}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-[15px] font-semibold text-[var(--fg)] leading-snug">{m.materia}</p>
                                {m.detalle && <p className="text-[12px] text-[var(--secondary)] mt-0.5">{m.detalle}</p>}
                              </div>
                              {m.nota && (
                                <span
                                  className="shrink-0 text-[26px] font-bold leading-none tabular-nums"
                                  style={{ color: estadoTone(m.estado) }}
                                >
                                  {m.nota}
                                </span>
                              )}
                            </>
                          );
                        })()}

                      {recurso === "correlatividades" &&
                        (() => {
                          const m = item as MateriaCorrelativa;
                          return (
                            <>
                              <div className="flex-1 min-w-0">
                                <p className="text-[15px] font-semibold text-[var(--fg)] leading-snug">{m.materia}</p>
                                {!m.puedeCursar && m.motivo && (
                                  <p className="text-[12px] text-[var(--secondary)] mt-0.5 whitespace-pre-line">{m.motivo}</p>
                                )}
                              </div>
                              <Pill
                                text={m.puedeCursar ? "Disponible" : "Bloqueada"}
                                tone={m.puedeCursar ? "#34c759" : "#ff9500"}
                              />
                            </>
                          );
                        })()}

                      {recurso === "materias" &&
                        (() => {
                          const m = item as MateriaPlan;
                          return (
                            <>
                              <div className="flex-1 min-w-0">
                                <p className="text-[15px] font-semibold text-[var(--fg)] leading-snug">{m.materia}</p>
                                <p className="text-[12px] text-[var(--secondary)] mt-0.5">
                                  {m.periodo}
                                  {m.electiva ? " · Electiva" : ""}
                                </p>
                              </div>
                              {m.seCursa && <Pill text="Cursa" tone="#007aff" />}
                            </>
                          );
                        })()}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Notas — lista plana de materias en curso */}
        {!loading && !error && recurso === "notas" && (
          <div className="space-y-3">
            {(data as MateriaCursando[]).map((m, i) => (
              <div
                key={i}
                className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {m.materiaUrl ? (
                      <a
                        href={m.materiaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[16px] font-bold text-[var(--fg)] leading-snug active:opacity-70"
                      >
                        {m.materia}
                        <ExternalLink className="w-3.5 h-3.5 text-[var(--secondary)] shrink-0" />
                      </a>
                    ) : (
                      <p className="text-[16px] font-bold text-[var(--fg)] leading-snug">{m.materia}</p>
                    )}
                    <p className="text-[12px] text-[var(--secondary)] mt-0.5">
                      Comisión {m.comision} · Nivel {m.nivel}
                    </p>
                  </div>
                  {m.inasistenciasTotal > 0 && (
                    <Pill
                      text={`${m.inasistenciasTotal} faltas`}
                      tone={m.inasistenciasTotal >= 3 ? "#ff3b30" : "#ff9500"}
                    />
                  )}
                </div>

                {m.horario && (
                  <p className="text-[13px] text-[var(--fg)] mt-3">{m.horario}</p>
                )}
                {m.modalidad && (
                  <p className="text-[12px] text-[var(--secondary)] mt-0.5">{m.modalidad}</p>
                )}

                <div className="mt-3 pt-3 border-t border-[var(--separator)] flex items-center justify-between">
                  <span className="text-[12px] text-[var(--secondary)]">Notas de parciales</span>
                  <span className="text-[13px] font-semibold text-[var(--fg)]">
                    {m.notasParciales || "Sin cargar"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
