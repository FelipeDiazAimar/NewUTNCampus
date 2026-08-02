"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import SysacadWsLogin from "@/components/sysacadws/LoginForm";
import MateriaInscripcionItem from "@/components/sysacadws/MateriaInscripcionItem";
import SegmentedControl from "@/components/campus/SegmentedControl";
import CampusView from "@/components/campus/CampusView";
import { SpinnerBlock } from "@/components/Spinner";
import {
  useMateriasParaCursado,
  postInscribir,
  postDesinscribir,
  fetchComisiones,
  type ComisionesResult,
} from "@/lib/sysacadHooks";
import { useCampusCatalogo, postMatricular } from "@/lib/campusHooks";
import { matchearCurso, parseCheckSum } from "@/lib/campus";
import { useCourses } from "@/lib/hooks";
import { isGuestMode, triggerGuestBlock } from "@/lib/guest";
import type {
  SysacadWsUser,
  SysacadMateriaParaCursado,
  SysacadMateriasParaCursado,
} from "@/lib/sysacadws";

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
  // Esta página vive bajo app/sysacad/layout.tsx, que envuelve /sysacad y
  // /sysacad/inscripcion en un SWRConfig con caché propia (persistida en
  // localStorage). Hay que usar el mutate de ESE contexto, no el `mutate`
  // global de "swr" — ese apunta a la caché por defecto y no revalida nada
  // de lo que se ve acá.
  const { mutate } = useSWRConfig();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SysacadWsUser | null>(null);
  const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [vista, setVista] = useState<"sysacad" | "campus">("sysacad");

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
  // No sabemos con certeza cómo señaliza Sysacad el cierre del período de
  // inscripción (nunca lo capturamos), pero en la práctica la sección
  // desaparece de la app oficial. Ante cualquier fallo que no sea sesión
  // vencida, se asume que la inscripción no está disponible ahora mismo (fin
  // de temporada o el servicio caído) y se griséa toda la sección en vez de
  // dejar pasar errores sueltos a la pantalla.
  const inscripcionNoDisponible = !isLoading && !!error && !sessionExpired;

  const materiasKey = legajo ? `/api/sysacadws/cursado/materiasparacursado/${legajo}` : null;

  const { data: catalogo, isLoading: catalogoLoading } = useCampusCatalogo(user?.especialidad);
  const { courses, refetch: refetchCourses } = useCourses();

  // Moodle tarda en reflejar una matriculación recién hecha en el web service
  // de cursos, así que los cursos que el servidor ya nos confirmó se suman a
  // mano: la confirmación es la redirección al curso, no hace falta esperarla.
  const [matriculadosLocal, setMatriculadosLocal] = useState<Set<string>>(new Set());
  const [sincronizandoCampus, setSincronizandoCampus] = useState(false);

  const idsMatriculados = useMemo(
    () => new Set([...courses.map((c) => String(c.id)), ...matriculadosLocal]),
    [courses, matriculadosLocal]
  );

  /** Marca el curso como matriculado y revalida la lista real en segundo plano. */
  async function confirmarMatricula(courseId: string) {
    setMatriculadosLocal((previos) => new Set(previos).add(courseId));
    setSincronizandoCampus(true);
    try {
      await refetchCourses();
    } finally {
      setSincronizandoCampus(false);
    }
  }

  const materias = data?.Materias ?? [];
  const inscriptas = materias.filter((m) => m.Comision !== "0");
  const disponibles = materias.filter((m) => m.Comision === "0");

  // Consulta las comisiones de todas las materias candidatas apenas se
  // conocen, para poder separar de entrada las bloqueadas por
  // correlatividades en su propia sección (en vez de descubrirlo recién al
  // tocar cada una).
  const [comisionesMap, setComisionesMap] = useState<Record<string, ComisionesResult>>({});
  const disponiblesKey = disponibles.map((m) => m.IdMateria).join(",");

  useEffect(() => {
    if (!legajo || disponibles.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        disponibles.map(async (m) => {
          const r = await fetchComisiones(legajo, m.Especialidad, m.Plan, m.IdMateria);
          return [m.IdMateria, r] as const;
        })
      );
      if (!cancelled) setComisionesMap(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legajo, disponiblesKey]);

  const comisionesLoaded = disponibles.every((m) => comisionesMap[m.IdMateria] !== undefined);
  const bloqueadas = comisionesLoaded
    ? disponibles.filter((m) => comisionesMap[m.IdMateria]?.ok === false)
    : [];
  const disponiblesReales = comisionesLoaded
    ? disponibles.filter((m) => comisionesMap[m.IdMateria]?.ok !== false)
    : [];

  async function handleInscribir(materia: SysacadMateriaParaCursado, comision: string) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
    if (!legajo) return;
    setBanner(null);

    const r = await postInscribir(legajo, materia, comision);
    if (!r.ok) {
      setBanner({ tone: "error", text: r.motivo });
      return;
    }

    // La clave de matriculación al campus recién existe después de inscribirse,
    // así que hay que releer la materia de la lista revalidada.
    const actualizado = materiasKey
      ? ((await mutate(materiasKey)) as SysacadMateriasParaCursado | undefined)
      : undefined;

    const conClave = (actualizado?.Materias ?? []).find((m) => m.IdMateria === materia.IdMateria);
    const clave = parseCheckSum(conClave?.CheckSum ?? "").claveMatriculacion;
    const curso = clave
      ? matchearCurso(
          materia.NombreMateriaLargo || materia.NombreMateria,
          (catalogo?.grupos ?? []).flatMap((g) => g.cursos),
          new Date().getFullYear(),
          catalogo?.carrera
        )
      : null;

    if (!clave || !curso) {
      setBanner({
        tone: "ok",
        text: `Te inscribiste a ${materia.NombreMateria} en Sysacad. Matriculate al campus desde la pestaña Campus.`,
      });
      return;
    }

    const rc = await postMatricular(curso.id, clave);
    if (rc.ok) {
      setBanner({
        tone: "ok",
        text: `Te inscribiste a ${materia.NombreMateria} en Sysacad y en el campus.`,
      });
      await confirmarMatricula(curso.id);
    } else {
      setBanner({
        tone: "error",
        text: `Te inscribiste a ${materia.NombreMateria} en Sysacad, pero la matrícula al campus falló: ${rc.motivo} Podés hacerla desde la pestaña Campus.`,
      });
    }
  }

  async function handleDesinscribir(materia: SysacadMateriaParaCursado) {
    if (isGuestMode()) { triggerGuestBlock(); return; }
    if (!legajo) return;
    setBanner(null);
    const r = await postDesinscribir(legajo, materia);
    if (r.ok) {
      setBanner({ tone: "ok", text: `Te desinscribiste de ${materia.NombreMateria}.` });
      if (materiasKey) await mutate(materiasKey);
    } else {
      setBanner({ tone: "error", text: r.motivo });
    }
  }

  function handleLoginSuccess() {
    setUser(getWsUser());
    mutate(() => true);
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

            {isLoading && <SpinnerBlock label="Cargando materias…" />}

            {inscripcionNoDisponible && (
              <div className="rounded-3xl border border-[var(--separator)] bg-[var(--surface2)] px-5 py-10 text-center opacity-80">
                <CalendarOff className="mx-auto h-8 w-8 text-[var(--secondary)]" />
                <p className="mt-3 text-[15px] font-semibold text-[var(--fg)]">Inscripción no disponible</p>
                <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-[var(--secondary)]">
                  Puede que el período de inscripción a materias esté cerrado o que el servicio de
                  Sysacad no esté respondiendo. Volvé a intentarlo más tarde.
                </p>
              </div>
            )}

            {!isLoading && !inscripcionNoDisponible && (
              <>
                <SegmentedControl
                  ariaLabel="Sistema de inscripción"
                  value={vista}
                  onChange={(v) => setVista(v as "sysacad" | "campus")}
                  options={[
                    { value: "sysacad", label: "Sysacad" },
                    { value: "campus", label: "Campus" },
                  ]}
                />

                {vista === "sysacad" && (
                  <>
                    {materias.length === 0 && (
                      <p className="py-8 text-center text-[14px] text-[var(--secondary)]">
                        No hay materias para cursado en este momento.
                      </p>
                    )}

                    {inscriptas.length > 0 && (
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

                    {/* Hasta que vuelven las comisiones de cada materia no se sabe
                        cuáles están bloqueadas por correlatividades, y mostrarlas
                        todas bajo "Podés inscribirte" para después reacomodarlas es
                        peor que esperar. */}
                    {disponibles.length > 0 && !comisionesLoaded && (
                      <section>
                        <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                          Podés inscribirte
                        </p>
                        <SpinnerBlock label="Consultando correlatividades…" />
                      </section>
                    )}

                    {comisionesLoaded && disponiblesReales.length > 0 && (
                      <section>
                        <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                          Podés inscribirte
                        </p>
                        <div className="space-y-2.5">
                          {disponiblesReales.map((m) => (
                            <MateriaInscripcionItem
                              key={m.IdMateria}
                              legajo={legajo!}
                              materia={m}
                              mode="disponible"
                              prefetched={comisionesMap[m.IdMateria]}
                              onInscribir={handleInscribir}
                              onDesinscribir={handleDesinscribir}
                            />
                          ))}
                        </div>
                      </section>
                    )}

                    {bloqueadas.length > 0 && (
                      <section>
                        <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                          Bloqueadas (correlatividades)
                        </p>
                        <div className="space-y-2.5">
                          {bloqueadas.map((m) => {
                            const r = comisionesMap[m.IdMateria];
                            return (
                              <MateriaInscripcionItem
                                key={m.IdMateria}
                                legajo={legajo!}
                                materia={m}
                                mode="bloqueada"
                                motivo={r?.ok === false ? r.motivo : undefined}
                                onInscribir={handleInscribir}
                                onDesinscribir={handleDesinscribir}
                              />
                            );
                          })}
                        </div>
                      </section>
                    )}
                  </>
                )}

                {vista === "campus" && (
                  <CampusView
                    inscriptas={inscriptas}
                    catalogo={catalogo}
                    loading={catalogoLoading}
                    idsMatriculados={idsMatriculados}
                    sincronizando={sincronizandoCampus}
                    onMatriculado={confirmarMatricula}
                  />
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
