"use client";

import { useState } from "react";
import { ChevronDown, GraduationCap } from "lucide-react";
import { parseNota, type SysacadComision, type SysacadExamen, type SysacadPlanMateria } from "@/lib/sysacadws";
import type { MateriaEstado } from "@/lib/sysacadTypes";
import CollapsibleCard from "./CollapsibleCard";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function formatFecha(iso: string): string {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : iso;
}

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(DIACRITICS, "").trim();
}

/** "Anual" | "1c" → "1er cuatrimestre" | "2c" → "2do cuatrimestre". */
function cuatriLabel(c?: string): string {
  if (!c) return "";
  const x = c.trim().toLowerCase();
  if (x === "anual") return "Anual";
  if (x.startsWith("1")) return "1er cuatrimestre";
  if (x.startsWith("2")) return "2do cuatrimestre";
  return "";
}

/** Abreviaturas de Sysacad → nombre completo. */
const PREFIJOS_PARCIAL: Record<string, string> = {
  par: "Parcial",
  int: "Integración",
  rec: "Recuperatorio",
};

/** "Par. 1" → "Parcial 1" | "Int. 1" → "Integración 1" | "Rec. 1" → "Recuperatorio 1". */
function traducirLabelParcial(label: string): string {
  const m = label.match(/^([A-Za-zÀ-ÿ]+)\.?\s*(\d+)?/);
  if (!m) return label;
  const prefijo = PREFIJOS_PARCIAL[m[1].toLowerCase()] ?? m[1];
  return m[2] ? `${prefijo} ${m[2]}` : prefijo;
}

/**
 * "Par. 1: 9 (nueve), Par. 2: 8 (ocho), Int. 1: 9 (nueve)" → una entrada por
 * parcial/integrador/recuperatorio, en el mismo orden en que Sysacad los lista.
 */
function parseParciales(raw: string | undefined): { label: string; nota: string }[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim().match(/^(.+?):\s*(\d+)/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ label: traducirLabelParcial(m[1].trim()), nota: m[2] }));
}

type Row = {
  materia: string;
  cuatri: string;
  estadoTxt: string;
  fecha?: string;
  notaLabel: string;
  notaTone: string;
  esNumero: boolean;
  /** Todos los exámenes finales rendidos para esta materia, más reciente primero. */
  intentos: SysacadExamen[];
  /** Notas de parciales/integradores de la cursada vigente (si la materia se está cursando o se acaba de cursar). */
  parciales: { label: string; nota: string }[];
};

/**
 * Sección unificada: combina Estado académico (scraping) + Historial de notas
 * (web service) + Parciales de la cursada vigente + cuatrimestre del Plan,
 * agrupada por año.
 */
export default function HistorialAcademico({
  estado,
  examenes,
  planMaterias,
  comisiones = [],
}: {
  estado: MateriaEstado[];
  examenes: SysacadExamen[];
  planMaterias: SysacadPlanMateria[];
  /** Comisiones de la cursada vigente (SysacadCursado.Comisiones) — trae los parciales. */
  comisiones?: SysacadComision[];
}) {
  const cuatriByName = new Map(planMaterias.map((m) => [norm(m.NombreMateria), m.Cuatrimestre]));

  // Todos los exámenes finales rendidos por materia, más reciente primero. Una
  // materia puede tener varios intentos (aplazos, recuperatorios): antes se
  // descartaban todos menos el último; ahora se conservan para el desglose.
  const examsByName = new Map<string, SysacadExamen[]>();
  for (const ex of examenes) {
    const k = norm(ex.NombreMateria);
    const arr = examsByName.get(k);
    if (arr) arr.push(ex);
    else examsByName.set(k, [ex]);
  }
  for (const arr of examsByName.values()) {
    arr.sort((a, b) => b.FechaExamen.localeCompare(a.FechaExamen));
  }

  // Notas de parciales por materia. Vienen de /cursado/coninasistencia, que
  // solo trae la cursada vigente — es un dato distinto de examenes (rendir el
  // final): una materia puede aprobarse "por parciales" (Ap. Directa) sin
  // rendir nunca un final, y ahí examenes no tiene ningún registro.
  const parcialesByName = new Map<string, { label: string; nota: string }[]>();
  for (const c of comisiones) {
    const list = parseParciales(c.Parciales);
    if (list.length > 0) parcialesByName.set(norm(c.NombreMateria), list);
  }

  // Construye una fila a partir del estado (o del plan si no hay scraping).
  function buildRow(materia: string, cuatriRaw: string | undefined, estadoRaw: string, nota: string | undefined): Row {
    const intentos = examsByName.get(norm(materia)) ?? [];
    const parciales = parcialesByName.get(norm(materia)) ?? [];
    const ultimo = intentos[0];
    let notaLabel = "—";
    let notaTone = "var(--secondary)";
    let esNumero = false;
    let estadoTxt = "";

    if (nota) {
      // Nota oficial de Sysacad ("Aprobada con X"): es el valor que cuenta
      // para la materia, no necesariamente igual al de un intento puntual
      // (puede reflejar la nota final de cursada, no solo el examen).
      notaLabel = nota;
      notaTone = Number(nota) >= 6 ? "#34c759" : "#ff3b30";
      esNumero = true;
      estadoTxt = "Aprobada";
    } else if (/cursa/i.test(estadoRaw)) {
      notaLabel = "Cursando";
      notaTone = "#007aff";
      estadoTxt = "Cursando";
    } else if (/aprob/i.test(estadoRaw)) {
      notaLabel = "Aprobada";
      notaTone = "#34c759";
      estadoTxt = "Aprobada";
    } else if (ultimo) {
      const n = parseNota(ultimo.Nota);
      notaLabel = n.label;
      notaTone = n.ausente ? "#8e8e93" : n.aprobada ? "#34c759" : "#ff3b30";
      esNumero = /^\d+$/.test(n.label);
      estadoTxt = "Rendida";
    } else {
      estadoTxt = "Pendiente";
    }
    return {
      materia,
      cuatri: cuatriLabel(cuatriRaw),
      estadoTxt,
      fecha: ultimo?.FechaExamen,
      notaLabel,
      notaTone,
      esNumero,
      intentos,
      parciales,
    };
  }

  // Spine: el estado académico (todas las materias con su situación). Si no está
  // disponible (sin sesión de scraping), usamos el plan de estudio. Cada fila
  // lleva su año para poder agrupar por año → cuatrimestre.
  const rows: (Row & { anio: string })[] = [];
  if (estado.length > 0) {
    for (const m of estado) {
      rows.push({ ...buildRow(m.materia, cuatriByName.get(norm(m.materia)), m.estado, m.nota), anio: m.nivel || "—" });
    }
  } else {
    for (const m of planMaterias) {
      rows.push({ ...buildRow(m.NombreMateria, m.Cuatrimestre, "", undefined), anio: m.Año || "—" });
    }
  }

  const anios = [...new Set(rows.map((r) => r.anio))].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));

  return (
    <CollapsibleCard
      title="Historial académico"
      icon={GraduationCap}
      iconColor="#af52de"
      right={<span className="text-[12px] text-[var(--secondary)]">{rows.length} materias</span>}
    >
      {rows.length === 0 ? (
        <p className="text-[14px] text-[var(--secondary)] text-center py-4">Sin información para mostrar.</p>
      ) : (
        <div className="space-y-4">
          {anios.map((anio) => {
            const delAnio = rows.filter((r) => r.anio === anio);
            const cuatris = [...new Set(delAnio.map((r) => r.cuatri))].sort((a, b) => cuatriRank(a) - cuatriRank(b));
            return (
              <div key={anio}>
                <p className="px-1 mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Año {anio}
                </p>
                <div className="space-y-3">
                  {cuatris.map((cuatri) => {
                    const list = delAnio.filter((r) => r.cuatri === cuatri);
                    return (
                      <div key={cuatri || "_"}>
                        {cuatri && (
                          <p className="px-1 mb-1 text-[11px] font-medium text-[var(--secondary)]">{cuatri}</p>
                        )}
                        <div className="rounded-2xl border border-[var(--separator)] overflow-hidden divide-y divide-[var(--separator)]">
                          {list.map((r, i) => (
                            <RowItem key={`${r.materia}-${i}`} r={r} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleCard>
  );
}

const CUATRI_ORDER = ["Anual", "1er cuatrimestre", "2do cuatrimestre"];
function cuatriRank(c: string): number {
  const i = CUATRI_ORDER.indexOf(c);
  return i === -1 ? CUATRI_ORDER.length : i; // sin cuatrimestre al final
}

/** Fila de materia, desplegable a sus parciales y/o exámenes finales cuando hay más de un dato. */
function RowItem({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const tieneHistorial = r.parciales.length > 0 || r.intentos.length > 1;

  return (
    <div>
      <button
        type="button"
        onClick={() => tieneHistorial && setOpen((o) => !o)}
        disabled={!tieneHistorial}
        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${
          tieneHistorial ? "active:bg-[var(--surface2)]" : "cursor-default"
        }`}
      >
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-[var(--fg)] leading-snug">{r.materia}</p>
          <p className="text-[12px] text-[var(--secondary)] mt-0.5">
            {[r.estadoTxt, r.fecha ? `rendida ${formatFecha(r.fecha)}` : ""].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {r.esNumero ? (
            <span className="text-[18px] font-bold tabular-nums" style={{ color: r.notaTone }}>
              {r.notaLabel}
            </span>
          ) : (
            <span
              className="rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap"
              style={{ backgroundColor: `${r.notaTone}1a`, color: r.notaTone }}
            >
              {r.notaLabel}
            </span>
          )}
          {tieneHistorial && (
            <ChevronDown
              className={`h-4 w-4 text-[var(--secondary)] transition-transform ${open ? "rotate-180" : ""}`}
            />
          )}
        </div>
      </button>

      {open && tieneHistorial && (
        <div className="space-y-3 border-t border-[var(--separator)] bg-[var(--surface2)] px-4 py-2.5">
          {r.parciales.length > 0 && (
            <div className="space-y-1.5">
              {r.parciales.map((p, i) => (
                <div key={`${p.label}-${i}`} className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--secondary)]">{p.label}</span>
                  <span
                    className="font-semibold tabular-nums"
                    style={{ color: Number(p.nota) >= 6 ? "#34c759" : "#ff3b30" }}
                  >
                    {p.nota}
                  </span>
                </div>
              ))}
            </div>
          )}

          {r.intentos.length > 1 && (
            <div className="space-y-1.5">
              {r.parciales.length > 0 && (
                <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--secondary)]">
                  Exámenes finales
                </p>
              )}
              {r.intentos.map((ex, i) => {
                const n = parseNota(ex.Nota);
                const tone = n.ausente ? "#8e8e93" : n.aprobada ? "#34c759" : "#ff3b30";
                return (
                  <div key={`${ex.FechaExamen}-${i}`} className="flex items-center justify-between text-[13px]">
                    <span className="text-[var(--secondary)]">{formatFecha(ex.FechaExamen)}</span>
                    <span className="font-semibold tabular-nums" style={{ color: tone }}>
                      {n.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
