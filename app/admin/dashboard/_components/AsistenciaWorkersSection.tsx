"use client";

import { useEffect, useState } from "react";
import { Radio, RotateCw, Square, Play } from "lucide-react";

type Worker = {
  id: string;
  actualizado: string;
  proceso_desde: string | null;
  version: string | null;
  estado: string;
  motivo: string | null;
  ram_total_mb: number;
  ram_usada_mb: number;
  polls_total: number;
  errores: number;
  login_ok: boolean;
  ultimo_error: string | null;
  rt_ultimo_ms: number;
  rt_prom_ms: number;
  rt_max_ms: number;
  rt_min_ms: number;
  materias_hoy: string | null;
  pushes_hoy: number;
  cuentas: number;
  comisiones: number;
  hace_ms: number;
  activa_hace_ms: number | null;
  conectada: boolean;
  comando: string | null;
  comando_ack: string | null;
  comando_vencido: boolean;
};

function dur(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const ms = (v: number) => (v ? `${v} ms` : "—");

function Dato({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-[var(--secondary)]">{k}</span>
      <span className="text-[14px] font-semibold text-[var(--fg)] tabular-nums">{v}</span>
    </div>
  );
}

function RamDato({ total, usada }: { total: number; usada: number }) {
  if (!total) return <Dato k="RAM de la PC" v="—" />;
  const pct = Math.min(100, Math.round((usada / total) * 100));
  const color = pct >= 88 ? "#ff3b30" : pct >= 70 ? "#ff9500" : "#34c759";
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-[var(--secondary)]">RAM de la PC</span>
      <span className="text-[14px] font-semibold text-[var(--fg)] tabular-nums">
        {(usada / 1024).toFixed(1)} / {(total / 1024).toFixed(1)} GB
      </span>
      <span className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--separator)]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
    </div>
  );
}

/** Monitor de las PCs que corren el daemon de asistencia. */
export default function AsistenciaWorkersSection() {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);

  async function mandarComando(id: string, cmd: "reiniciar" | "frenar" | "arrancar") {
    setEnviando(id + cmd);
    try {
      await fetch("/api/admin/asistencia-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, cmd }),
      });
    } catch {
      /* el estado se ve en el próximo poll */
    } finally {
      setEnviando(null);
    }
  }

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const r = await fetch("/api/admin/asistencia-workers", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { workers: Worker[] };
        if (vivo) {
          setWorkers(j.workers);
          setErr(null);
        }
      } catch (e) {
        if (vivo) setErr(String((e as Error).message || e));
      }
    };
    cargar();
    const t = setInterval(cargar, 5000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  return (
    <section className="mb-7">
      <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
        Daemon de asistencia — workers
      </p>

      <div className="space-y-3">
        {err && <p className="px-4 text-[13px] text-[#ff3b30]">No se pudo leer el monitor: {err}</p>}

        {workers && workers.length === 0 && (
          <div className="rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] px-4 py-6 text-center">
            <Radio className="mx-auto h-6 w-6 text-[var(--secondary)]" />
            <p className="mt-2 text-[13px] text-[var(--secondary)]">
              Ningún worker reportó todavía. Iniciá{" "}
              <code>scripts/asistencia-daemon/start.ps1</code> con <code>-AppUrl</code> y{" "}
              <code>NOTIFICATIONS_WEBHOOK_SECRET</code> configurado.
            </p>
          </div>
        )}

        {workers?.map((w) => {
          const online = w.conectada;
          return (
            <div
              key={w.id}
              className="overflow-hidden rounded-[20px] border bg-[var(--surface)] shadow-sm"
              style={{ borderColor: online ? "rgba(52,199,89,0.35)" : "rgba(255,59,48,0.3)" }}
            >
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--separator)]">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: online ? "#34c759" : "#ff3b30" }}
                />
                <span className="text-[15px] font-semibold text-[var(--fg)] truncate">{w.id}</span>
                <span
                  className="ml-auto text-[12px] font-medium"
                  style={{ color: online ? "#34c759" : "#ff3b30" }}
                >
                  {online ? "conectada" : "desconectada"}
                </span>
              </div>

              <div className="px-4 py-3 grid grid-cols-3 gap-x-3 gap-y-3 md:grid-cols-4">
                <Dato
                  k="Activa hace"
                  v={online && w.activa_hace_ms != null ? dur(w.activa_hace_ms) : "—"}
                />
                <Dato k="Última señal" v={`hace ${dur(w.hace_ms)}`} />
                <RamDato total={w.ram_total_mb} usada={w.ram_usada_mb} />

                <Dato k="Polls" v={w.polls_total} />
                <Dato k="Errores" v={w.errores} />
                <Dato
                  k="Login legacy"
                  v={
                    <span style={{ color: w.login_ok ? "#34c759" : "#ff3b30" }}>
                      {w.login_ok ? "OK" : "fallando"}
                    </span>
                  }
                />

                <Dato k="RT último" v={ms(w.rt_ultimo_ms)} />
                <Dato k="RT promedio" v={ms(w.rt_prom_ms)} />
                <Dato k="RT mín / máx" v={`${ms(w.rt_min_ms)} / ${ms(w.rt_max_ms)}`} />

                <Dato k="Materias hoy" v={w.materias_hoy || "—"} />
                <Dato k="Pushes hoy" v={w.pushes_hoy} />

                <Dato k="Cuentas" v={w.cuentas ?? 0} />
                <Dato k="Comisiones" v={w.comisiones ?? 0} />
              </div>

              {!online && (
                <div className="px-4 py-2.5 border-t border-[var(--separator)] bg-[rgba(255,59,48,0.06)]">
                  <p className="text-[12px] text-[#ff3b30]">
                    {w.estado === "apagado" && w.motivo
                      ? `Apagada: ${w.motivo}`
                      : `Sin señal desde ${new Date(w.actualizado).toLocaleTimeString("es-AR")} — PC apagada, sin internet, o el script se cerró.`}
                  </p>
                </div>
              )}

              {w.ultimo_error && (
                <div className="px-4 py-1.5 border-t border-[var(--separator)]">
                  <p className="text-[11px] text-[var(--secondary)] truncate">
                    último error: {w.ultimo_error}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--separator)]">
                {(
                  [
                    ["reiniciar", "Reiniciar", RotateCw, "#007aff"],
                    ["frenar", "Frenar", Square, "#ff3b30"],
                    ["arrancar", "Arrancar", Play, "#34c759"],
                  ] as const
                ).map(([cmd, label, Icon, color]) => (
                  <button
                    key={cmd}
                    type="button"
                    disabled={enviando === w.id + cmd}
                    onClick={() => mandarComando(w.id, cmd)}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--separator)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--fg)] transition-colors active:bg-black/5 disabled:opacity-40 dark:active:bg-white/5"
                  >
                    <Icon className="h-[13px] w-[13px]" style={{ color }} />
                    {label}
                  </button>
                ))}
                {w.comando && (
                  <span className="ml-auto text-[11px] text-[var(--secondary)]">
                    {w.comando}
                    {w.comando_ack
                      ? " · confirmado ✓"
                      : w.comando_vencido
                        ? " · sin respuesta"
                        : " · pendiente…"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
