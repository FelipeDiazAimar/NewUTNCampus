"use client";

import { useEffect, useState } from "react";
import { Server } from "lucide-react";

type Worker = {
  id: string;
  actualizado: string;
  proceso_desde: string | null;
  wss_url: string | null;
  version: string | null;
  estado: string;
  motivo: string | null;
  conex_total: number;
  conex_actual: number;
  conex_max: number;
  en_cola: number;
  pool: number;
  errores: number;
  rechazos: number;
  rt_ultimo_ms: number;
  rt_prom_ms: number;
  rt_max_ms: number;
  rt_min_ms: number;
  hace_ms: number;
  activa_hace_ms: number | null;
  conectada: boolean;
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

/** Monitor de las PCs que corren el worker del captcha remoto. */
export default function CaptchaWorkersSection() {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const r = await fetch("/api/admin/captcha-workers", { cache: "no-store" });
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
        Captcha remoto — workers
      </p>

      <div className="space-y-3">
        {err && (
          <p className="px-4 text-[13px] text-[#ff3b30]">No se pudo leer el monitor: {err}</p>
        )}

        {workers && workers.length === 0 && (
          <div className="rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] px-4 py-6 text-center">
            <Server className="mx-auto h-6 w-6 text-[var(--secondary)]" />
            <p className="mt-2 text-[13px] text-[var(--secondary)]">
              Ningún worker reportó todavía. Iniciá <code>start.ps1</code> con el heartbeat
              configurado (<code>-AppUrl</code> + <code>CAPTCHA_HEARTBEAT_SECRET</code> en Vercel).
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

              <div className="px-4 py-3 grid grid-cols-3 gap-x-3 gap-y-3">
                <Dato
                  k="Activa hace"
                  v={online && w.activa_hace_ms != null ? dur(w.activa_hace_ms) : "—"}
                />
                <Dato k="Última señal" v={`hace ${dur(w.hace_ms)}`} />
                <Dato k="Versión" v={w.version || "—"} />

                <Dato k="Conexiones ahora" v={w.conex_actual} />
                <Dato k="Máx simultáneas" v={w.conex_max} />
                <Dato k="Total conexiones" v={w.conex_total} />

                <Dato k="En cola" v={w.en_cola} />
                <Dato k="Pool listo" v={w.pool} />
                <Dato k="Errores / rechazos" v={`${w.errores} / ${w.rechazos}`} />

                <Dato k="RT último" v={ms(w.rt_ultimo_ms)} />
                <Dato k="RT promedio" v={ms(w.rt_prom_ms)} />
                <Dato k="RT mín / máx" v={`${ms(w.rt_min_ms)} / ${ms(w.rt_max_ms)}`} />
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
            </div>
          );
        })}
      </div>
    </section>
  );
}
