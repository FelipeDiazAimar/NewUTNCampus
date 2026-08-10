"use client";

import { useEffect, useState } from "react";
import { Search, X, Copy, Check, ChevronDown } from "lucide-react";
import SegmentedControl from "@/components/campus/SegmentedControl";

type Severity = "critical" | "error" | "warning";

interface ErrorEvent {
  id: number;
  severity: Severity;
  source: "client" | "server";
  message: string;
  stack: string | null;
  section: string | null;
  consoleLog: { level: string; args: string; at: string }[] | null;
  requestInfo: Record<string, unknown> | null;
  userAgent: string | null;
  createdAt: string;
}

const SEVERITY_COLORS: Record<Severity, string> = { critical: "#ff3b30", error: "#ff9500", warning: "#ffcc00" };
const SEVERITY_LABELS: Record<Severity, string> = { critical: "Crítico", error: "Error", warning: "Warning" };

function buildCopyText(e: ErrorEvent): string {
  const lines = [
    `Severidad: ${SEVERITY_LABELS[e.severity]}`,
    `Fecha: ${new Date(e.createdAt).toLocaleString("es-AR")}`,
    `Sección: ${e.section ?? "—"}`,
    `Origen: ${e.source === "client" ? "Cliente" : "Servidor"}`,
    `Mensaje: ${e.message}`,
  ];
  if (e.stack) lines.push("", "Stack:", e.stack);
  if (e.consoleLog?.length) {
    lines.push("", "Consola:");
    for (const c of e.consoleLog) lines.push(`[${c.level}] ${c.at}: ${c.args}`);
  }
  if (e.requestInfo) lines.push("", "Request:", JSON.stringify(e.requestInfo, null, 2));
  if (e.userAgent) lines.push("", `User agent: ${e.userAgent}`);
  return lines.join("\n");
}

/** Modal con buscador y filtro de severidad: errores individuales en el rango dado. */
export default function ErrorEventsModal({
  open,
  onClose,
  from,
  to,
}: {
  open: boolean;
  onClose: () => void;
  from: string;
  to: string;
}) {
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState<string>("all");
  const [events, setEvents] = useState<ErrorEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ from, to });
      if (q.trim()) params.set("q", q.trim());
      if (severity !== "all") params.set("severity", severity);
      fetch(`/api/admin/error-events?${params}`)
        .then((r) => r.json())
        .then((json) => setEvents(json.events ?? []))
        .catch(() => setEvents([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [open, from, to, q, severity]);

  async function copy(e: ErrorEvent) {
    try {
      await navigator.clipboard.writeText(buildCopyText(e));
      setCopiedId(e.id);
      setTimeout(() => setCopiedId((id) => (id === e.id ? null : id)), 1500);
    } catch {
      /* clipboard puede no estar disponible (ej. sin HTTPS) */
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-6"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
      role="dialog"
      aria-modal="true"
    >
      <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={onClose} />

      <div className="relative w-full sm:max-w-lg max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-[var(--separator)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[17px] font-bold text-[var(--fg)]">Errores</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[var(--surface2)] flex items-center justify-center active:opacity-70"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4 text-[var(--secondary)]" />
          </button>
        </div>

        <div className="px-5 pb-3 space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--separator)] bg-[var(--surface2)] px-3 py-2.5">
            <Search className="w-4 h-4 text-[var(--secondary)]" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por mensaje o sección"
              className="flex-1 bg-transparent outline-none text-[15px] text-[var(--fg)] placeholder:text-[var(--secondary)]"
              autoFocus
            />
          </div>
          <SegmentedControl
            ariaLabel="Severidad"
            value={severity}
            onChange={setSeverity}
            options={[
              { value: "all", label: "Todos" },
              { value: "critical", label: "Crítico" },
              { value: "error", label: "Error" },
              { value: "warning", label: "Warning" },
            ]}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 divide-y divide-[var(--separator)]">
          {loading ? (
            <p className="text-[13px] text-[var(--secondary)] text-center py-8">Buscando…</p>
          ) : events.length === 0 ? (
            <p className="text-[13px] text-[var(--secondary)] text-center py-8">Sin resultados.</p>
          ) : (
            events.map((e) => {
              const expanded = expandedId === e.id;
              return (
                <div key={e.id} className="py-3">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 text-left"
                    onClick={() => setExpandedId(expanded ? null : e.id)}
                  >
                    <div className="min-w-0">
                      <p
                        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: SEVERITY_COLORS[e.severity] }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: SEVERITY_COLORS[e.severity] }} />
                        {SEVERITY_LABELS[e.severity]}
                      </p>
                      <p className="text-[14px] font-medium text-[var(--fg)] truncate">{e.message}</p>
                      <p className="text-[12px] text-[var(--secondary)] truncate">{e.section ?? "—"}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2 text-right">
                      <p className="text-[11px] text-[var(--secondary)]">{new Date(e.createdAt).toLocaleString("es-AR")}</p>
                      <ChevronDown className={`w-4 h-4 text-[var(--secondary)] transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {expanded && (
                    <div className="mt-2 rounded-xl bg-[var(--surface2)] p-3 space-y-2">
                      {e.stack && (
                        <pre className="text-[11px] text-[var(--fg)] whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                          {e.stack}
                        </pre>
                      )}
                      {e.consoleLog && e.consoleLog.length > 0 && (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {e.consoleLog.map((c, i) => (
                            <p key={i} className="text-[11px] text-[var(--secondary)] break-words">
                              <span className="font-semibold">[{c.level}]</span> {c.args}
                            </p>
                          ))}
                        </div>
                      )}
                      {e.requestInfo && (
                        <pre className="text-[11px] text-[var(--fg)] whitespace-pre-wrap break-words">
                          {JSON.stringify(e.requestInfo, null, 2)}
                        </pre>
                      )}
                      <button
                        type="button"
                        onClick={() => copy(e)}
                        className="flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-3 py-1.5 text-[12px] font-semibold text-[#007aff] active:opacity-70"
                      >
                        {copiedId === e.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedId === e.id ? "Copiado" : "Copiar"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
