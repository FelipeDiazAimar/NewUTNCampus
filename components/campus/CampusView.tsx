"use client";

import { useMemo, useState } from "react";
import { Check, Copy, GraduationCap, KeyRound } from "lucide-react";
import CollapsibleCard from "@/components/sysacadws/CollapsibleCard";
import EstadoSincronizacion from "@/components/campus/EstadoSincronizacion";
import Spinner, { SpinnerBlock } from "@/components/Spinner";
import { matchearCurso, parseCheckSum, type CampusCatalogo, type CampusCurso } from "@/lib/campus";
import { postMatricular } from "@/lib/campusHooks";
import { isGuestMode, triggerGuestBlock } from "@/lib/guest";
import type { SysacadMateriaParaCursado } from "@/lib/sysacadws";

/** Botón de copiar al portapapeles con confirmación efímera. */
function CopiarClave({ clave }: { clave: string }) {
  const [copiada, setCopiada] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(clave);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      // Portapapeles no disponible: sin acción.
    }
  }
  return (
    <button
      type="button"
      onClick={copiar}
      className="flex items-center justify-center gap-1.5 rounded-xl border border-[#5ac8fa4d] px-3 py-2 text-[12px] font-semibold text-[#0a91c9] transition-colors hover:bg-[#5ac8fa1a] active:bg-[#5ac8fa26] dark:text-[#5ac8fa]"
    >
      {copiada ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copiada ? "Copiada" : `Copiar clave (${clave})`}
    </button>
  );
}

/** Fila del catálogo: se despliega para pegar la clave y matricularse. */
function FilaCurso({
  curso,
  matriculado,
  onMatricular,
}: {
  curso: CampusCurso;
  matriculado: boolean;
  onMatricular: (curso: CampusCurso, clave: string) => Promise<void>;
}) {
  const [abierta, setAbierta] = useState(false);
  const [clave, setClave] = useState("");
  const [ocupado, setOcupado] = useState(false);

  if (matriculado) {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--fg)]">{curso.nombre}</span>
        <span className="shrink-0 rounded-full bg-[#34c7591a] px-2.5 py-1 text-[11px] font-semibold text-[#34c759]">
          Matriculado
        </span>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        disabled={!curso.autoMatriculacion}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface2)] active:bg-[var(--surface2)] disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--fg)]">{curso.nombre}</span>
        {curso.autoMatriculacion ? (
          <KeyRound className="h-3.5 w-3.5 shrink-0 text-[var(--secondary)]" />
        ) : (
          <span className="shrink-0 text-[11px] text-[var(--secondary)]">Sin clave</span>
        )}
      </button>

      {abierta && curso.autoMatriculacion && (
        <div className="flex gap-2 px-4 pb-3">
          <input
            type="text"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder="Clave de matriculación"
            className="login-input min-w-0 flex-1 rounded-xl border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--fg)] outline-none placeholder:text-[var(--secondary)]"
          />
          <button
            type="button"
            disabled={!clave.trim() || ocupado}
            onClick={async () => {
              setOcupado(true);
              try {
                await onMatricular(curso, clave.trim());
              } finally {
                setOcupado(false);
              }
            }}
            className="shrink-0 rounded-xl border border-[#007aff33] px-3 py-2 text-[12px] font-semibold text-[#007aff] transition-colors hover:bg-[#007aff1a] active:bg-[#007aff26] disabled:opacity-40"
          >
            {ocupado ? "…" : "Matricularme"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function CampusView({
  inscriptas,
  catalogo,
  loading,
  idsMatriculados,
  sincronizando,
  onMatriculado,
}: {
  inscriptas: SysacadMateriaParaCursado[];
  catalogo: CampusCatalogo | undefined;
  loading: boolean;
  idsMatriculados: Set<string>;
  /** Hay una matrícula confirmada esperando a que Moodle la refleje. */
  sincronizando?: boolean;
  onMatriculado: (courseId: string) => void | Promise<void>;
}) {
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);

  const anio = new Date().getFullYear();
  const todosLosCursos = useMemo(
    () => (catalogo?.grupos ?? []).flatMap((g) => g.cursos),
    [catalogo]
  );

  // Cada materia de Sysacad, con el curso del campus que le corresponde (si se
  // pudo identificar) y si ya está matriculada.
  const filas = useMemo(
    () =>
      inscriptas.map((m) => {
        const curso = matchearCurso(
          m.NombreMateriaLargo || m.NombreMateria,
          todosLosCursos,
          anio,
          catalogo?.carrera
        );
        return {
          materia: m,
          curso,
          clave: parseCheckSum(m.CheckSum ?? "").claveMatriculacion,
          matriculada: curso ? idsMatriculados.has(curso.id) : false,
        };
      }),
    [inscriptas, todosLosCursos, idsMatriculados, anio, catalogo?.carrera]
  );

  const pendientes = filas.filter((f) => !f.matriculada);
  const matriculadas = filas.filter((f) => f.matriculada);

  async function matricular(curso: CampusCurso, clave: string) {
    if (isGuestMode()) {
      triggerGuestBlock();
      return;
    }
    setAviso(null);
    setOcupada(curso.id);
    try {
      const r = await postMatricular(curso.id, clave);
      if (r.ok) {
        setAviso({ tono: "ok", texto: `Te matriculaste en ${curso.nombre}.` });
        await onMatriculado(curso.id);
      } else {
        setAviso({ tono: "error", texto: r.motivo });
      }
    } finally {
      setOcupada(null);
    }
  }

  if (loading && !catalogo) {
    return <SpinnerBlock label="Cargando catálogo del campus…" />;
  }

  return (
    <div className="space-y-4">
      {aviso && (
        <div
          className={
            aviso.tono === "ok"
              ? "rounded-2xl border border-[#34c75933] bg-[#34c7590d] px-4 py-3 text-[13px] font-medium text-[#34c759]"
              : "rounded-2xl border border-[#ffcdd2] bg-[#fff2f2] px-4 py-3 text-[13px] font-medium text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]"
          }
        >
          {aviso.texto}
        </div>
      )}

      {pendientes.length > 0 && (
        <section>
          <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
            Pendientes de matrícula
          </p>
          <div className="space-y-2.5">
            {pendientes.map(({ materia, curso, clave }) => (
              <div
                key={materia.IdMateria}
                className="rounded-2xl border border-[var(--separator)] px-4 py-3.5"
              >
                <p className="text-[15px] font-semibold text-[var(--fg)]">{materia.NombreMateria}</p>
                <div className="mt-1">
                  <EstadoSincronizacion sysacad campus={false} />
                </div>
                {!clave ? (
                  <p className="mt-2 text-[12px] text-[var(--secondary)]">
                    Sysacad no devolvió la clave de matriculación de esta materia.
                  </p>
                ) : curso ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={ocupada === curso.id}
                      onClick={() => matricular(curso, clave)}
                      className="flex-1 rounded-xl border border-[#007aff33] px-3 py-2 text-[12px] font-semibold text-[#007aff] transition-colors hover:bg-[#007aff1a] active:bg-[#007aff26] disabled:opacity-40"
                    >
                      {ocupada === curso.id ? "Matriculando…" : "Matricularme"}
                    </button>
                    <CopiarClave clave={clave} />
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <p className="text-[12px] text-[var(--secondary)]">
                      No pude identificar el curso en el campus. Buscalo en el catálogo de abajo y
                      pegá la clave.
                    </p>
                    <CopiarClave clave={clave} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {(matriculadas.length > 0 || sincronizando) && (
        <section>
          <p className="mb-2 flex items-center gap-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
            Matriculadas
            {sincronizando && <Spinner size={13} />}
          </p>
          {matriculadas.length === 0 && sincronizando && (
            <SpinnerBlock label="Confirmando la matrícula en el campus…" minHeight={72} />
          )}
          <div className="space-y-2.5">
            {matriculadas.map(({ materia }) => (
              <div
                key={materia.IdMateria}
                className="rounded-2xl border border-[#34c75933] bg-[#34c7590d] px-4 py-3.5"
              >
                <p className="text-[15px] font-semibold text-[var(--fg)]">{materia.NombreMateria}</p>
                <div className="mt-1">
                  <EstadoSincronizacion sysacad campus />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {catalogo && catalogo.grupos.length === 0 && (
        <div className="rounded-2xl border border-[var(--separator)] px-4 py-6 text-center">
          <GraduationCap className="mx-auto h-6 w-6 text-[var(--secondary)]" />
          <p className="mt-2 text-[14px] text-[var(--secondary)]">
            {catalogo.carrera
              ? "No hay cursos del ciclo actual en el catálogo de tu carrera."
              : "No encontré tu carrera en el campus. Podés matricularte desde el campus virtual pegando la clave."}
          </p>
        </div>
      )}

      {(catalogo?.grupos ?? []).map((g) => (
        <CollapsibleCard key={g.categoriaId} title={g.titulo} icon={GraduationCap} iconColor="#007aff">
          <div className="divide-y divide-[var(--separator)] overflow-hidden rounded-2xl border border-[var(--separator)]">
            {g.cursos.map((c) => (
              <FilaCurso
                key={c.id}
                curso={c}
                matriculado={idsMatriculados.has(c.id)}
                onMatricular={matricular}
              />
            ))}
          </div>
        </CollapsibleCard>
      ))}
    </div>
  );
}
