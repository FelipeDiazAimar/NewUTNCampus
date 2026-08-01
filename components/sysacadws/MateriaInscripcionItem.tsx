"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronDown, Clock, Copy, Lock, MapPin } from "lucide-react";
import type { SysacadComisionDisponible, SysacadMateriaParaCursado } from "@/lib/sysacadws";
import { fetchComisiones, type ComisionesResult } from "@/lib/sysacadHooks";

/**
 * El campo CheckSum trae dos datos separados por salto de línea:
 * "0V58ZF\nClave matriculación campus virtual = 5202340512026" — el código
 * de seguridad de la inscripción, y la clave para auto-matricularse en el
 * curso del campus virtual (Moodle).
 */
function parseCheckSum(checkSum: string): { claveMatriculacion: string | null } {
  const claveLinea = checkSum.split("\n").find((l) => /clave matriculaci/i.test(l));
  const clave = claveLinea?.split("=")[1]?.trim() ?? null;
  return { claveMatriculacion: clave || null };
}

/** Botón para copiar la clave de matriculación al portapapeles, con feedback visual. */
function CopiarClaveButton({ clave }: { clave: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(clave);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Portapapeles no disponible (permiso denegado, contexto no seguro, etc.) — sin acción.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex-1 rounded-xl border border-[#5ac8fa4d] px-2 py-2 text-[11px] font-semibold leading-snug text-[#0a91c9] transition-colors hover:bg-[#5ac8fa1a] active:bg-[#5ac8fa26] dark:text-[#5ac8fa]"
    >
      <span className="flex items-center justify-center gap-1.5">
        {copied ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Copy className="h-3.5 w-3.5 shrink-0" />}
        {copied ? "Copiada" : `Copiar clave de matriculación al campus virtual (${clave})`}
      </span>
    </button>
  );
}

/** Fila de chips de color para curso/horario/edificio — reemplaza el texto plano. */
function InfoChips({
  curso,
  horario,
  edificio,
}: {
  curso?: string;
  horario?: string;
  edificio?: string;
}) {
  const horarios = (horario ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (!curso && horarios.length === 0 && !edificio) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {curso && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#007aff1a] px-2.5 py-1 text-[11px] font-medium text-[#007aff]">
          <CalendarDays className="h-3 w-3 shrink-0" />
          Curso {curso}
        </span>
      )}
      {horarios.map((h, i) => (
        <span
          key={`${h}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-[#ff95001a] px-2.5 py-1 text-[11px] font-medium text-[#ff9500]"
        >
          <Clock className="h-3 w-3 shrink-0" />
          {h}
        </span>
      ))}
      {edificio && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#af52de1a] px-2.5 py-1 text-[11px] font-medium text-[#af52de]">
          <MapPin className="h-3 w-3 shrink-0" />
          {edificio}
        </span>
      )}
    </div>
  );
}

export default function MateriaInscripcionItem({
  legajo,
  materia,
  mode,
  motivo,
  prefetched,
  onInscribir,
  onDesinscribir,
}: {
  legajo: string;
  materia: SysacadMateriaParaCursado;
  mode: "inscripta" | "disponible" | "bloqueada";
  /** Requerido cuando mode === "bloqueada": motivo de correlatividades sin cumplir. */
  motivo?: string;
  /** Resultado de comisiones ya consultado por la página (evita refetch al expandir). */
  prefetched?: ComisionesResult;
  onInscribir: (materia: SysacadMateriaParaCursado, comision: string) => Promise<void>;
  onDesinscribir: (materia: SysacadMateriaParaCursado) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loadingComisiones, setLoadingComisiones] = useState(false);
  const [result, setResult] = useState<ComisionesResult | null>(prefetched ?? null);
  const [selected, setSelected] = useState<string | null>(
    prefetched?.ok && prefetched.comisiones.length === 1 ? prefetched.comisiones[0].Comision : null
  );
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

  if (mode === "bloqueada") {
    return (
      <div className="rounded-2xl border border-[var(--separator)] bg-[var(--surface2)] px-4 py-3.5 opacity-60">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--fg)]">{materia.NombreMateria}</p>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#ff95001a] px-2.5 py-1 text-[11px] font-semibold text-[#ff9500]">
            <Lock className="h-3 w-3" />
            Bloqueada
          </span>
        </div>
        {motivo && <p className="mt-1 text-[12px] leading-snug text-[var(--secondary)]">{motivo}</p>}
      </div>
    );
  }

  if (mode === "inscripta") {
    const { claveMatriculacion } = materia.CheckSum ? parseCheckSum(materia.CheckSum) : { claveMatriculacion: null };
    return (
      <div className="rounded-2xl border border-[#34c75933] bg-[#34c7590d] px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-[var(--fg)]">{materia.NombreMateria}</p>
            <InfoChips curso={materia.Curso} horario={materia.Horario} edificio={materia.Edificio} />
          </div>
          <span className="shrink-0 rounded-full bg-[#34c7591a] px-2.5 py-1 text-[11px] font-semibold text-[#34c759]">
            Inscripto
          </span>
        </div>
        <div className="mt-3 flex gap-2">
          {claveMatriculacion && <CopiarClaveButton clave={claveMatriculacion} />}
          <button
            type="button"
            onClick={handleDesinscribir}
            disabled={busy}
            className="flex-1 rounded-xl border border-[#ff3b3033] py-2 text-[13px] font-semibold text-[#ff3b30] transition-colors hover:bg-[#ff3b301a] active:bg-[#ff3b3026] disabled:opacity-50"
          >
            {busy ? "Procesando…" : "Desinscribirme"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--separator)]">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface2)] active:bg-[var(--surface2)]"
      >
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
                <ComisionRadioList
                  comisiones={result.comisiones}
                  idMateria={materia.IdMateria}
                  selected={selected}
                  onSelect={setSelected}
                />
              ) : (
                <div className="rounded-xl border border-[var(--separator)] px-3 py-2.5">
                  <p className="text-[13px] font-medium text-[var(--fg)]">
                    {result.comisiones[0].Curso ? `Comisión ${result.comisiones[0].Curso}` : "Comisión única"}
                  </p>
                  <InfoChips horario={result.comisiones[0].Horario} edificio={result.comisiones[0].Edificio} />
                </div>
              )}

              <button
                type="button"
                onClick={handleInscribir}
                disabled={!selected || busy}
                className="w-full rounded-xl border border-[#007aff33] py-2 text-[13px] font-semibold text-[#007aff] transition-colors hover:bg-[#007aff1a] active:bg-[#007aff26] disabled:opacity-40"
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

/** Radios de selección de comisión, con chips de horario/edificio por opción. */
function ComisionRadioList({
  comisiones,
  idMateria,
  selected,
  onSelect,
}: {
  comisiones: SysacadComisionDisponible[];
  idMateria: string;
  selected: string | null;
  onSelect: (comision: string) => void;
}) {
  return (
    <div className="space-y-2">
      {comisiones.map((c) => (
        <label
          key={c.Comision}
          className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--separator)] px-3 py-2.5"
        >
          <input
            type="radio"
            name={`comision-${idMateria}`}
            checked={selected === c.Comision}
            onChange={() => onSelect(c.Comision)}
            className="mt-0.5 accent-[#007aff]"
          />
          <span className="min-w-0 flex-1">
            <span className="text-[13px] font-medium text-[var(--fg)]">
              {c.Curso ? `Comisión ${c.Curso}` : `Comisión ${c.Comision}`}
            </span>
            <InfoChips horario={c.Horario} edificio={c.Edificio} />
          </span>
        </label>
      ))}
    </div>
  );
}
