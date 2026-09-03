// Métricas del daemon de asistencia. Singleton en memoria del proceso.
// Se serializa con snapshot() y va en el heartbeat cada ~10s.
// Adaptado de lib/captchaMetricas.ts (poll en vez de conexiones).

import fs from "node:fs";
import os from "node:os";

const VENTANA_RT = 50;

/** RAM de la PC (no del proceso). Copiado de lib/captchaMetricas.ts. */
function ramHost(): { total: number; usada: number } {
  try {
    const t = fs.readFileSync("/proc/meminfo", "utf8");
    const kb = (k: string) => Number(t.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] || 0);
    const total = kb("MemTotal");
    const disp = kb("MemAvailable") || kb("MemFree");
    if (total) {
      return { total: Math.round(total / 1024), usada: Math.round((total - disp) / 1024) };
    }
  } catch {
    /* no es Linux */
  }
  const total = Math.round(os.totalmem() / 1048576);
  return { total, usada: total - Math.round(os.freemem() / 1048576) };
}

/** YYYY-MM-DD en Argentina. */
function hoyArg(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

class MetricasAsistencia {
  readonly procesoDesde = Date.now();
  version = process.env.ASISTENCIA_WORKER_VERSION || "";

  pollsTotal = 0;
  errores = 0;
  loginOk = false;
  ultimoError = "";
  pushesHoy = 0;

  private rts: number[] = [];
  private dia = hoyArg();
  private materiasHoy = new Set<string>();

  private rolarDia(): void {
    const h = hoyArg();
    if (h !== this.dia) {
      this.dia = h;
      this.materiasHoy.clear();
      this.pushesHoy = 0;
    }
  }

  registrarPoll(): void {
    this.rolarDia();
    this.pollsTotal++;
  }

  registrarRt(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.rts.push(Math.round(ms));
    if (this.rts.length > VENTANA_RT) this.rts.shift();
  }

  registrarError(mensaje: string): void {
    this.errores++;
    this.ultimoError = mensaje.slice(0, 300);
  }

  setLoginOk(v: boolean): void {
    this.loginOk = v;
  }

  agregarMateria(nombre: string): void {
    this.rolarDia();
    this.materiasHoy.add(nombre);
  }

  sumarPushes(n: number): void {
    this.rolarDia();
    this.pushesHoy += Math.max(0, n);
  }

  snapshot(): Record<string, unknown> {
    const rts = this.rts;
    const prom = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0;
    const ram = ramHost();
    return {
      proceso_desde: new Date(this.procesoDesde).toISOString(),
      version: this.version,
      ram_total_mb: ram.total,
      ram_usada_mb: ram.usada,
      polls_total: this.pollsTotal,
      errores: this.errores,
      login_ok: this.loginOk,
      ultimo_error: this.ultimoError || null,
      rt_ultimo_ms: rts.at(-1) ?? 0,
      rt_prom_ms: prom,
      rt_max_ms: rts.length ? Math.max(...rts) : 0,
      rt_min_ms: rts.length ? Math.min(...rts) : 0,
      materias_hoy: [...this.materiasHoy].join(", ") || null,
      pushes_hoy: this.pushesHoy,
    };
  }
}

export const metricas = new MetricasAsistencia();
