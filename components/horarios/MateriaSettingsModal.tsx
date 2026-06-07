"use client";

import { useEffect, useState } from "react";
import { X, RotateCcw } from "lucide-react";
import { saveMateriaSettings, resetMateriaSettings, type MateriaSettings } from "@/lib/materiaSettings";

const COLORS = [
  "#ff3b30", "#ff9500", "#ffcc00", "#34c759",
  "#30b0c7", "#007aff", "#af52de", "#5856d6", "#8e8e93",
];

export default function MateriaSettingsModal({
  materia,
  current,
  defaultColor,
  rawAula,
  onClose,
  onSaved,
}: {
  materia: string | null;
  current: MateriaSettings;
  defaultColor: string;
  rawAula: string;
  onClose: () => void;
  onSaved: (name: string, s: MateriaSettings) => void;
}) {
  const [color, setColor] = useState(current.color ?? defaultColor);
  const [aula, setAula] = useState(current.aula ?? rawAula);

  useEffect(() => {
    if (!materia) return;
    setColor(current.color ?? defaultColor);
    setAula(current.aula ?? rawAula);
  }, [materia, current, defaultColor, rawAula]);

  if (!materia) return null;

  function save() {
    const s: MateriaSettings = { color, aula: aula.trim() || undefined };
    saveMateriaSettings(materia!, s);
    onSaved(materia!, s);
    onClose();
  }

  function reset() {
    resetMateriaSettings(materia!);
    onSaved(materia!, {});
    onClose();
  }

  const field =
    "w-full rounded-xl border border-[var(--separator)] bg-[var(--surface2)] px-3 py-2.5 text-[15px] text-[var(--fg)] outline-none focus:border-[var(--accent)]";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button type="button" aria-label="Cerrar" onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        style={{ animation: "sheet-up 0.25s ease" }}
        className="relative w-full sm:max-w-md bg-[var(--surface)] rounded-t-3xl sm:rounded-3xl border border-[var(--navbar-border)] shadow-xl p-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[18px] font-bold text-[var(--fg)]">Editar materia</h2>
          <button type="button" onClick={onClose} className="p-1.5 -mr-1.5 text-[var(--secondary)] active:opacity-70">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[13px] text-[var(--secondary)] mb-4 leading-snug">{materia}</p>

        <div className="space-y-4">
          <div>
            <label className="text-[12px] font-medium text-[var(--secondary)] px-1">Aula</label>
            <input
              value={aula}
              onChange={(e) => setAula(e.target.value)}
              placeholder="Ej: Aula 12, Lab. Informática…"
              maxLength={80}
              className={`${field} mt-1`}
            />
          </div>

          <div>
            <label className="text-[12px] font-medium text-[var(--secondary)] px-1">Color</label>
            <div className="flex gap-2.5 mt-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-transform ${color === c ? "ring-2 ring-offset-2 ring-offset-[var(--surface)] scale-110" : ""}`}
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={save}
          className="w-full mt-5 py-3.5 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80"
        >
          Guardar
        </button>

        <button
          type="button"
          onClick={reset}
          className="w-full mt-2 py-2.5 rounded-2xl text-[var(--secondary)] text-[14px] font-medium flex items-center justify-center gap-1.5 active:opacity-70"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Restablecer por defecto
        </button>
      </div>
    </div>
  );
}
