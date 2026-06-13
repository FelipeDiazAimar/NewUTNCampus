"use client";

import { useMemo, useState } from "react";
import { CalendarHeart, X } from "lucide-react";
import type { SysacadCursado, SysacadPlan } from "@/lib/sysacadws";
import { useInasistenciasMap } from "@/lib/sysacadHooks";
import {
  computeHeatmap,
  computeRiesgoInasistencias,
  RIESGO_META,
  type DiaHeatmap,
  type MateriaRiesgo,
} from "@/lib/sysacadAsistencia";
import CollapsibleCard from "./CollapsibleCard";

const CUATRI_LABEL: Record<string, string> = { "1c": "1º cuatri", "2c": "2º cuatri", anual: "Anual" };

// ─── Semáforo del 70% por materia ─────────────────────────────────────────────

function RiesgoRow({ r }: { r: MateriaRiesgo }) {
  const meta = RIESGO_META[r.nivel];
  const pct = r.maxFaltas > 0 ? Math.min(100, Math.round((r.faltas / r.maxFaltas) * 100)) : 0;

  const mensaje =
    r.totalClases === 0
      ? "No pudimos estimar las clases de esta materia."
      : r.nivel === "libre"
        ? `Superaste el límite de ${r.maxFaltas} faltas.`
        : r.faltasRestantes <= 0
          ? "Llegaste al límite: no podés faltar más."
          : `Podés faltar ${r.faltasRestantes} ${r.faltasRestantes === 1 ? "vez" : "veces"} más.`;

  return (
    <div className="rounded-2xl border border-[var(--separator)] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-[var(--fg)]">{r.materia}</p>
          <p className="mt-0.5 text-[12px] text-[var(--secondary)]">
            {CUATRI_LABEL[r.cuatri]} · {r.faltas} de {r.maxFaltas} faltas permitidas
            {r.justificadas > 0 ? ` · ${r.justificadas} just.` : ""}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ backgroundColor: meta.bg, color: meta.color }}
        >
          {meta.label}
        </span>
      </div>

      {r.totalClases > 0 && (
        <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[var(--surface2)]">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ width: `${pct}%`, background: meta.color }}
          />
        </div>
      )}
      <p className="mt-1.5 text-[12px] font-medium" style={{ color: meta.color }}>
        {mensaje}
      </p>
    </div>
  );
}

// ─── Heatmap estilo GitHub (presente / ausente) ───────────────────────────────

const MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Lunes = 0 … Domingo = 6. */
function rowOf(d: Date): number {
  return (d.getDay() + 6) % 7;
}
function fmtLargo(iso: string): string {
  const d = isoToDate(iso);
  return `${d.getDate()} de ${MESES_LARGO[d.getMonth()]}`;
}

type Celda = { iso: string; dia?: DiaHeatmap; inRange: boolean };

function Heatmap({ dias, primera, ultima }: { dias: Map<string, DiaHeatmap>; primera: string; ultima: string }) {
  const [sel, setSel] = useState<DiaHeatmap | null>(null);

  const semanasFiltradas = useMemo(() => {
    const start = isoToDate(primera);
    start.setDate(start.getDate() - rowOf(start)); // retroceder al lunes
    const end = isoToDate(ultima);

    const all: { celdas: Celda[]; mes: number }[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const celdas: Celda[] = [];
      const mesSemana = cursor.getMonth();
      for (let r = 0; r < 7; r++) {
        const iso = toIso(cursor);
        // Solo lunes–viernes (rowOf = 0..4); sábado=5, domingo=6 se omiten
        if (r < 5) {
          celdas.push({ iso, dia: dias.get(iso), inRange: iso >= primera && iso <= ultima });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      all.push({ celdas, mes: mesSemana });
    }
    // Ocultar semanas completamente vacías (sin ningún día con clase real)
    return all.filter((s) => s.celdas.some((c) => c.dia != null));
  }, [dias, primera, ultima]);

  return (
    <div>
      {/* Etiquetas de mes (alineadas a las columnas con el mismo flex) */}
      <div className="mb-1 flex gap-[3px]">
        {semanasFiltradas.map((s, i) => {
          const nuevoMes = i === 0 || s.mes !== semanasFiltradas[i - 1].mes;
          return (
            <span key={i} className="min-w-0 flex-1 text-[9px] font-medium leading-none text-[var(--secondary)]">
              {nuevoMes ? MESES_CORTO[s.mes] : ""}
            </span>
          );
        })}
      </div>

      {/* Grilla: columnas flex-1 → ocupa todo el ancho del contenedor */}
      <div className="flex gap-[3px]">
        {semanasFiltradas.map((s, ci) => (
          <div key={ci} className="flex min-w-0 flex-1 flex-col gap-[3px]">
            {s.celdas.map((cell, ri) => {
              const active = sel?.fecha === cell.iso;
              const mixed = !!cell.dia && cell.dia.ausenteEn.length > 0 && cell.dia.ausenteEn.length < cell.dia.materias.length;
              let bg = "transparent";
              let border = "transparent";
              if (cell.dia) {
                bg = mixed
                  ? "linear-gradient(135deg, #34c759 50%, #ff3b30 50%)"
                  : cell.dia.estado === "ausente" ? "#ff3b30" : "#34c759";
              } else if (cell.inRange) border = "var(--separator)";
              const titleText = cell.dia
                ? mixed
                  ? `${fmtLargo(cell.iso)} · Asististe a: ${cell.dia.materias.filter(m => !cell.dia!.ausenteEn.includes(m)).join(", ")} · Faltaste en: ${cell.dia.ausenteEn.join(", ")}`
                  : cell.dia.estado === "ausente"
                    ? `${fmtLargo(cell.iso)} · Faltaste en: ${cell.dia.ausenteEn.join(", ")}`
                    : `${fmtLargo(cell.iso)} · Asististe a: ${cell.dia.materias.join(", ")}`
                : "";
              return (
                <button
                  key={ri}
                  type="button"
                  disabled={!cell.dia}
                  onClick={() => setSel(cell.dia ?? null)}
                  title={titleText}
                  className="aspect-square w-full rounded-[3px] transition-transform disabled:cursor-default"
                  style={{
                    background: bg,
                    border: bg === "transparent" ? `1px solid ${border}` : "none",
                    outline: active ? "2px solid var(--fg)" : "none",
                    outlineOffset: active ? "1px" : "0",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Detalle del día seleccionado */}
      {sel && (() => {
        const isMixed = sel.ausenteEn.length > 0 && sel.ausenteEn.length < sel.materias.length;
        const presentes = isMixed ? sel.materias.filter((m) => !sel.ausenteEn.includes(m)) : [];
        return (
          <div className="mt-3 rounded-xl border border-[var(--separator)] bg-[var(--surface2)] px-3 py-2.5">
            <div className="flex items-start gap-2.5">
              <span
                className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{
                  background: isMixed
                    ? "linear-gradient(135deg, #34c759 50%, #ff3b30 50%)"
                    : sel.estado === "ausente" ? "#ff3b30" : "#34c759",
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold capitalize text-[var(--fg)]">{fmtLargo(sel.fecha)}</p>
                {isMixed ? (
                  <div className="mt-1 space-y-0.5">
                    <p className="text-[12px] text-[var(--secondary)]">
                      <span className="font-medium text-[#34c759]">Asististe</span> · {presentes.join(", ")}
                    </p>
                    <p className="text-[12px] text-[var(--secondary)]">
                      <span className="font-medium text-[#ff3b30]">Faltaste</span> · {sel.ausenteEn.join(", ")}
                    </p>
                  </div>
                ) : (
                  <p className="mt-0.5 text-[12px] text-[var(--secondary)]">
                    {sel.estado === "ausente"
                      ? `Faltaste en ${sel.ausenteEn.join(", ")}`
                      : `Asististe · ${sel.materias.join(", ")}`}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setSel(null)} className="shrink-0 text-[var(--secondary)] active:opacity-60">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Ring de asistencia global ────────────────────────────────────────────────

function AttendanceRing({ pct, presentes, ausentes }: { pct: number; presentes: number; ausentes: number }) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const filled = (pct / 100) * circ;
  const tone = pct >= 70 ? "#34c759" : pct >= 60 ? "#ff9500" : "#ff3b30";
  const label = pct >= 70 ? "En regla" : pct >= 60 ? "Atención" : "En riesgo";

  return (
    <div className="flex items-center gap-5 rounded-2xl bg-[var(--surface2)] px-4 py-4">
      {/* Anillo SVG */}
      <div className="relative h-[96px] w-[96px] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--separator)" strokeWidth="10" />
          <circle
            cx="50" cy="50" r={r} fill="none"
            stroke={tone} strokeWidth="10"
            strokeDasharray={`${filled} ${circ}`}
            strokeLinecap="round"
            className="transition-[stroke-dasharray] duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-bold leading-none" style={{ color: tone }}>{pct}%</span>
          <span className="mt-0.5 text-[10px] font-medium text-[var(--secondary)]">{label}</span>
        </div>
      </div>

      {/* Stats al lado */}
      <div className="flex-1 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[13px] text-[var(--secondary)]">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#34c759]" />
            Presencias
          </span>
          <span className="text-[15px] font-bold text-[#34c759]">{presentes}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[13px] text-[var(--secondary)]">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#ff3b30]" />
            Inasistencias
          </span>
          <span className="text-[15px] font-bold text-[#ff3b30]">{ausentes}</span>
        </div>
        <div className="h-px bg-[var(--separator)]" />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-[var(--secondary)]">Total clases</span>
          <span className="text-[13px] font-semibold text-[var(--fg)]">{presentes + ausentes}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Card contenedora ─────────────────────────────────────────────────────────

export default function AsistenciaCard({
  cursado,
  plan,
  especialidad,
  legajo,
}: {
  cursado: SysacadCursado;
  plan: SysacadPlan;
  especialidad: string;
  legajo?: string;
}) {
  const hoy = useMemo(() => new Date(), []);
  const anio = hoy.getFullYear();
  const hoyIso = useMemo(() => toIso(hoy), [hoy]);
  const primeraFecha = `${anio}-01-01`;

  const { data: inas } = useInasistenciasMap(legajo, anio);

  const riesgos = useMemo(
    () => computeRiesgoInasistencias(cursado, plan, especialidad),
    [cursado, plan, especialidad]
  );
  const heat = useMemo(
    () => computeHeatmap(cursado, plan, especialidad, inas instanceof Map ? inas : new Map()),
    [cursado, plan, especialidad, inas]
  );

  const hayCursado = (cursado.Comisiones ?? []).length > 0;
  const totalClases = heat.presentes + heat.ausentes;
  const pctGlobal = totalClases > 0
    ? Math.round((heat.presentes / totalClases) * 100)
    : null;

  return (
    <CollapsibleCard
      title="Asistencia"
      icon={CalendarHeart}
      iconColor="#ff2d55"
      right={
        pctGlobal != null ? (
          <span
            className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{
              backgroundColor: pctGlobal >= 70 ? "#34c7591a" : pctGlobal >= 60 ? "#ff95001a" : "#ff3b301a",
              color: pctGlobal >= 70 ? "#34c759" : pctGlobal >= 60 ? "#ff9500" : "#ff3b30",
            }}
          >
            {pctGlobal}%
          </span>
        ) : undefined
      }
    >
      {!hayCursado ? (
        <p className="py-4 text-center text-[14px] text-[var(--secondary)]">No hay materias en curso.</p>
      ) : (
        <div className="space-y-4">
          {/* Ring visual global */}
          {pctGlobal != null && (
            <AttendanceRing pct={pctGlobal} presentes={heat.presentes} ausentes={heat.ausentes} />
          )}

          {/* Semáforo del 70% por materia */}
          <div className="space-y-2.5">
            {riesgos.map((r, i) => (
              <RiesgoRow key={`${r.materia}-${i}`} r={r} />
            ))}
            <p className="px-1 text-[11px] leading-relaxed text-[var(--secondary)]">
              Necesitás asistir al 70% de las clases para no quedar libre. El límite de faltas se
              estima cruzando tus horarios con el calendario académico (cuatrimestral vs. anual).
            </p>
          </div>

          {/* Heatmap — siempre de 1 ene hasta hoy */}
          <div className="rounded-2xl border border-[var(--separator)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-semibold text-[var(--fg)]">Mapa de asistencia {anio}</p>
              <div className="flex items-center gap-3 text-[11px] text-[var(--secondary)]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-[#34c759]" />
                  {heat.presentes}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-[#ff3b30]" />
                  {heat.ausentes}
                </span>
              </div>
            </div>
            <Heatmap dias={heat.dias} primera={primeraFecha} ultima={hoyIso} />
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}
