// Métricas del worker del captcha remoto. Singleton en memoria del proceso del
// worker (scripts/captcha-remoto/server.mts). Se serializa con snapshot() y va
// en el heartbeat a /api/captcha/heartbeat cada ~10s.

import fs from "node:fs";
import os from "node:os";

const VENTANA_RT = 50; // últimos N tiempos de respuesta para prom/max/min

// RAM de la PC (no del proceso). En Linux usa /proc/meminfo MemAvailable, que
// es la RAM realmente usable (lo que muestra `free -m` como "disponible");
// os.freemem() sube muy poco porque no cuenta la caché reclamable.
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
    /* no es Linux o no hay /proc */
  }
  const total = Math.round(os.totalmem() / 1048576);
  return { total, usada: total - Math.round(os.freemem() / 1048576) };
}

class MetricasCaptcha {
  readonly procesoDesde = Date.now();
  version = process.env.CAPTCHA_WORKER_VERSION || "";
  wssUrl = process.env.CAPTCHA_WORKER_WSS_URL || "";

  conexTotal = 0;
  conexActual = 0;
  conexMax = 0;
  errores = 0;
  rechazos = 0;

  private rts: number[] = [];

  conexAbierta(): void {
    this.conexTotal++;
    this.conexActual++;
    if (this.conexActual > this.conexMax) this.conexMax = this.conexActual;
  }

  conexCerrada(): void {
    this.conexActual = Math.max(0, this.conexActual - 1);
  }

  // RT = desde que llega "iniciar" hasta que se emite "listo" (cuánto tarda en
  // dar un captcha listo).
  registrarRt(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.rts.push(Math.round(ms));
    if (this.rts.length > VENTANA_RT) this.rts.shift();
  }

  registrarError(mensaje: string): void {
    this.errores++;
    if (/esperando|mucha gente/i.test(mensaje)) this.rechazos++;
  }

  snapshot(interno: { enCola: number; pool: number }): Record<string, unknown> {
    const rts = this.rts;
    const prom = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0;
    const ram = ramHost();
    return {
      proceso_desde: new Date(this.procesoDesde).toISOString(),
      wss_url: this.wssUrl,
      version: this.version,
      ram_total_mb: ram.total,
      ram_usada_mb: ram.usada,
      conex_total: this.conexTotal,
      conex_actual: this.conexActual,
      conex_max: this.conexMax,
      en_cola: interno.enCola,
      pool: interno.pool,
      errores: this.errores,
      rechazos: this.rechazos,
      rt_ultimo_ms: rts.at(-1) ?? 0,
      rt_prom_ms: prom,
      rt_max_ms: rts.length ? Math.max(...rts) : 0,
      rt_min_ms: rts.length ? Math.min(...rts) : 0,
    };
  }
}

export const metricas = new MetricasCaptcha();
