"use client";

import { useState } from "react";
import { ChevronDown, CircleDot, Lock, MapPin } from "lucide-react";
import type { SysacadMateriaParaCursado } from "@/lib/sysacadws";
import { fetchComisiones, type ComisionesResult } from "@/lib/sysacadHooks";

export default function MateriaInscripcionItem({
  legajo,
  materia,
  mode,
  onInscribir,
  onDesinscribir,
}: {
  legajo: string;
  materia: SysacadMateriaParaCursado;
  mode: "inscripta" | "disponible";
  onInscribir: (materia: SysacadMateriaParaCursado, comision: string) => Promise<void>;
  onDesinscribir: (materia: SysacadMateriaParaCursado) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loadingComisiones, setLoadingComisiones] = useState(false);
  const [result, setResult] = useState<ComisionesResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (mode !== "disponible") return;
    const next = !expanded;
    setExpanded(next);
    if (next && !result && !loadingComisiones) {
      setLoadingComisiones(true);
      const r = await fetchComisiones(legajo, materia.Especialidad, materia.Plan, materia.IdMateria);
      setLoadingComisiones(false);
      setResult(r);
      if (r.ok && r.comisiones.length === 1) setSelected(r.comisiones[0].Comision);
    }
  }

  async function handleInscribir() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await onInscribir(materia, selected);
    } finally {
      setBusy(false);
    }
  }

  async function handleDesinscribir() {
    if (busy) return;
    setBusy(true);
    try {
      await onDesinscribir(materia);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "inscripta") {
    return (
      <div className="rounded-2xl border border-[#34c75933] bg-[#34c7590d] px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[var(--fg)]">{materia.NombreMateria}</p>
            {materia.Horario && (
              <p className="mt-0.5 text-[12px] text-[var(--secondary)]">{materia.Horario}</p>
            )}
            {materia.Edificio && (
              <p className="mt-0.5 flex items-center gap-1 text-[12px] text-[var(--secondary)]">
                <MapPin className="h-3 w-3 shrink-0" />
                {materia.Edificio}
              </p>
            )}
            {materia.CheckSum && (
              <p className="mt-1 whitespace-pre-line text-[11px] leading-snug text-[var(--secondary)]">
                {materia.CheckSum}
              </p>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-[#34c7591a] px-2.5 py-1 text-[11px] font-semibold text-[#34c759]">
            Inscripto
          </span>
        </div>
        <button
          type="button"
          onClick={handleDesinscribir}
          disabled={busy}
          className="mt-3 w-full rounded-xl border border-[#ff3b3033] py-2 text-[13px] font-semibold text-[#ff3b30] active:opacity-70 disabled:opacity-50"
        >
          {busy ? "Procesando…" : "Desinscribirme"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--separator)]">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-[var(--surface2)]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#007aff1a]">
          <CircleDot className="h-4 w-4 text-[#007aff]" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--fg)]">{materia.NombreMateria}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--secondary)] transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-[var(--separator)] px-4 py-3.5">
          {loadingComisiones && (
            <p className="text-[13px] text-[var(--secondary)]">Consultando comisiones…</p>
          )}

          {!loadingComisiones && result && !result.ok && (
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#ff9500]" />
              <p className="text-[13px] leading-snug text-[var(--secondary)]">{result.motivo}</p>
            </div>
          )}

          {!loadingComisiones && result && result.ok && result.comisiones.length === 0 && (
            <p className="text-[13px] text-[var(--secondary)]">No hay comisiones ofertadas por el momento.</p>
          )}

          {!loadingComisiones && result && result.ok && result.comisiones.length > 0 && (
            <div className="space-y-3">
              {result.comisiones.length > 1 ? (
                <div className="space-y-2">
                  {result.comisiones.map((c) => (
                    <label
                      key={c.Comision}
                      className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--separator)] px-3 py-2.5"
                    >
                      <input
                        type="radio"
                        name={`comision-${materia.IdMateria}`}
                        checked={selected === c.Comision}
                        onChange={() => setSelected(c.Comision)}
                        className="mt-0.5 accent-[#007aff]"
                      />
                      <span className="text-[13px] text-[var(--fg)]">
                        <span className="font-medium">{c.Curso || `Comisión ${c.Comision}`}</span>
                        {c.Horario && <span className="block text-[12px] text-[var(--secondary)]">{c.Horario}</span>}
                        {c.Edificio && <span className="block text-[12px] text-[var(--secondary)]">{c.Edificio}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--separator)] px-3 py-2.5 text-[13px] text-[var(--fg)]">
                  <p className="font-medium">{result.comisiones[0].Curso || "Comisión única"}</p>
                  {result.comisiones[0].Horario && (
                    <p className="text-[12px] text-[var(--secondary)]">{result.comisiones[0].Horario}</p>
                  )}
                  {result.comisiones[0].Edificio && (
                    <p className="text-[12px] text-[var(--secondary)]">{result.comisiones[0].Edificio}</p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleInscribir}
                disabled={!selected || busy}
                className="w-full rounded-xl bg-[#007aff] py-2 text-[13px] font-semibold text-white active:opacity-80 disabled:opacity-40"
              >
                {busy ? "Procesando…" : "Inscribirme"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
