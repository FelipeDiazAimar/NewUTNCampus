"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { EVENT_COLORS } from "@/lib/customEvents";
import { DAY_LABELS } from "@/lib/horarios";
import Spinner from "@/components/Spinner";

const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0]; // Lun..Dom

export default function CustomEventModal({
  open,
  defaultDay,
  onClose,
  onCreated,
}: {
  open: boolean;
  defaultDay: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [day, setDay] = useState(defaultDay);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("19:00");
  const [color, setColor] = useState(EVENT_COLORS[5]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (end <= start) {
      setError("La hora de fin debe ser posterior a la de inicio.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/schedule-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, dayOfWeek: day, startTime: start, endTime: end, colorHex: color }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No se pudo guardar el evento.");
        return;
      }
      onCreated();
      onClose();
    } catch {
      setError("Error de conexión.");
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-xl border border-[var(--separator)] bg-[var(--surface2)] px-3 py-2.5 text-[15px] text-[var(--fg)] outline-none focus:border-[var(--accent)]";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button type="button" aria-label="Cerrar" onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <form
        onSubmit={save}
        style={{ animation: "sheet-up 0.25s ease" }}
        className="relative w-full sm:max-w-md bg-[var(--surface)] rounded-t-3xl sm:rounded-3xl border border-[var(--navbar-border)] shadow-xl p-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[18px] font-bold text-[var(--fg)]">Nuevo evento</h2>
          <button type="button" onClick={onClose} className="p-1.5 -mr-1.5 text-[var(--secondary)] active:opacity-70">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-medium text-[var(--secondary)] px-1">Título</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Gimnasio, trabajo, grupo de estudio…" required maxLength={120} className={`${field} mt-1`} />
          </div>

          <div>
            <label className="text-[12px] font-medium text-[var(--secondary)] px-1">Descripción (opcional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} className={`${field} mt-1`} />
          </div>

          <div>
            <label className="text-[12px] font-medium text-[var(--secondary)] px-1">Día</label>
            <select value={day} onChange={(e) => setDay(Number(e.target.value))} className={`${field} mt-1 appearance-none`}>
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>{DAY_LABELS[d]}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[12px] font-medium text-[var(--secondary)] px-1">Inicio</label>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required className={`${field} mt-1`} />
            </div>
            <div className="flex-1">
              <label className="text-[12px] font-medium text-[var(--secondary)] px-1">Fin</label>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required className={`${field} mt-1`} />
            </div>
          </div>

          <div>
            <label className="text-[12px] font-medium text-[var(--secondary)] px-1">Color</label>
            <div className="flex gap-2.5 mt-2 flex-wrap">
              {EVENT_COLORS.map((c) => (
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

          {error && <p className="text-[13px] text-[#ff3b30] px-1">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full mt-5 py-3.5 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {saving ? <><Spinner size={18} color="#ffffff" /> Guardando…</> : "Guardar evento"}
        </button>
      </form>
    </div>
  );
}
