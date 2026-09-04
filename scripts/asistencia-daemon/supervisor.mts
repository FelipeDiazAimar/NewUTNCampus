#!/usr/bin/env node
// Worker de asistencia — un solo proceso.
//
// (Antes eran 2 procesos: supervisor + daemon. Se fusionaron para bajar a ~la
// mitad la RAM del server. El archivo sigue llamándose supervisor.mts para no
// tener que re-editar start.ps1 / asistencia-worker.service ya deployados.)
//
// Qué hace:
//  - Cada 30 min: GET /api/asistencia/credenciales (cuentas de usuarios con el
//    aviso activo; el server descifra).
//  - Descubrimiento (1/min): login al legacy por formulario + parseo de las
//    comisiones de apply-leave.php -> POST /api/asistencia/credenciales/comisiones.
//  - Cada 10 min: chequeo escalonado de 1 cuenta representante por comisión
//    distinta; por cada option data-habilitada="S" -> POST /api/webhooks/asistencia
//    (idempotente por día/materia).
//  - Heartbeat cada 10s a /api/asistencia/worker/heartbeat.
//  - Poll de comandos cada 15s: frenar / arrancar / reiniciar desde
//    /admin/dashboard, in-process (start/stop de timers, sin matar el proceso).
//
// Rate-limit: >= 3s entre requests al legacy. Sesión PHP cacheada 20 min.
// Se corre con el TypeScript nativo de Node 22.6+/24.

import os from "node:os";
import { login as legacyLogin, fetchApplyLeave } from "../../lib/asistenciaLegacy.ts";
import { metricas } from "./metricas.mts";

const CONFIG = {
  appUrl: (process.env.CAMPUS_APP_URL || "https://campus-utn.vercel.app").replace(/\/$/, ""),
  secret: process.env.NOTIFICATIONS_WEBHOOK_SECRET || "",
  workerId: (process.env.ASISTENCIA_WORKER_NAME || os.hostname() || "asistencia-daemon").slice(0, 80),
  refrescoCuentasMs: 30 * 60_000,
  chequeoVentanaMs: 10 * 60_000,
  descubrimientoGapMs: 60_000,
  sesionTtlMs: 20 * 60_000,
  comisionesTtlMs: 7 * 86_400_000,
  legacyGapMs: 3_000,
};

type Materia = {
  id: string; anio: string; especialidad: string; plan: string;
  comision: string; condicional: boolean; habilitada: boolean; nombre: string;
};
type Cuenta = { legajo: string; auth: string; comisiones: Materia[] | null; comisionesAt: number };

const cuentas = new Map<string, Cuenta>();
const sesiones = new Map<string, { cookie: string; loginAt: number }>();
const representanteRoto = new Set<string>(); // legajos marcados como rotos en la vuelta actual
let ultimoHitLegacy = 0;
let ultimoLoginOk = false;

function ts() {
  return new Date().toISOString();
}

async function esperarTurnoLegacy() {
  const espera = ultimoHitLegacy + CONFIG.legacyGapMs - Date.now();
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimoHitLegacy = Date.now();
}

function claveComision(m: Materia) {
  return `${m.especialidad}|${m.plan}|${m.comision}|${m.id}`;
}

function authToLegajoDni(auth: string): [string, string] {
  const dec = Buffer.from(auth, "base64").toString("utf8");
  const i = dec.indexOf(":");
  return [dec.slice(0, i), dec.slice(i + 1)];
}

async function api(path: string, init: RequestInit = {}) {
  return fetch(`${CONFIG.appUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-worker-secret": CONFIG.secret, ...(init.headers || {}) },
  });
}

// ── Cuentas ────────────────────────────────────────────────────────────────
async function refrescarCuentas() {
  try {
    const r = await api("/api/asistencia/credenciales");
    if (!r.ok) {
      console.warn(`[${ts()}] GET credenciales -> HTTP ${r.status}`);
      return;
    }
    const j = (await r.json()) as {
      credenciales: { legajo: string; auth: string; comisiones: Materia[] | null; comisiones_at: string | null }[];
    };
    const vistos = new Set<string>();
    for (const c of j.credenciales) {
      vistos.add(c.legajo);
      const prev = cuentas.get(c.legajo);
      cuentas.set(c.legajo, {
        legajo: c.legajo,
        auth: c.auth,
        comisiones: c.comisiones ?? prev?.comisiones ?? null,
        comisionesAt: c.comisiones_at ? new Date(c.comisiones_at).getTime() : prev?.comisionesAt ?? 0,
      });
    }
    for (const legajo of [...cuentas.keys()]) if (!vistos.has(legajo)) cuentas.delete(legajo);
    console.log(`[${ts()}] cuentas: ${cuentas.size}`);
  } catch (e) {
    console.warn(`[${ts()}] refrescarCuentas: ${String((e as Error).message).slice(0, 120)}`);
  }
}

// ── Sesión PHP cacheada ────────────────────────────────────────────────────
async function sesionDe(legajo: string): Promise<string | null> {
  const cache = sesiones.get(legajo);
  if (cache && Date.now() - cache.loginAt < CONFIG.sesionTtlMs) return cache.cookie;
  const cuenta = cuentas.get(legajo);
  if (!cuenta) return null;
  const [lg, dni] = authToLegajoDni(cuenta.auth);
  await esperarTurnoLegacy();
  let cookie: string | null = null;
  try {
    cookie = await legacyLogin(lg, dni);
  } catch (e) {
    metricas.registrarError(`login ${legajo}: ${String((e as Error).message).slice(0, 80)}`);
  }
  ultimoLoginOk = !!cookie;
  metricas.setLoginOk(!!cookie);
  if (!cookie) return null;
  sesiones.set(legajo, { cookie, loginAt: Date.now() });
  return cookie;
}

// ── Descubrimiento ─────────────────────────────────────────────────────────
async function descubrir(legajo: string) {
  const cookie = await sesionDe(legajo);
  if (!cookie) return;
  let materias: Materia[] = [];
  try {
    await esperarTurnoLegacy();
    const { page } = await fetchApplyLeave(cookie);
    if (page.autenticado) materias = page.materias as Materia[];
  } catch (e) {
    metricas.registrarError(`descubrir ${legajo}: ${String((e as Error).message).slice(0, 80)}`);
    return;
  }
  const c = cuentas.get(legajo);
  if (c) {
    c.comisiones = materias;
    c.comisionesAt = Date.now();
  }
  try {
    await api("/api/asistencia/credenciales/comisiones", {
      method: "POST",
      body: JSON.stringify({ legajo, comisiones: materias }),
    });
  } catch {
    /* se reintenta la próxima vuelta */
  }
  console.log(`[${ts()}] descubrir ${legajo}: ${materias.length} comisión(es)`);
}

async function correrDescubrimientosPendientes() {
  const pendientes = [...cuentas.values()].filter(
    (c) => c.comisiones == null || Date.now() - c.comisionesAt > CONFIG.comisionesTtlMs
  );
  for (const c of pendientes) {
    if (apagando || !corriendo) return;
    await descubrir(c.legajo);
    await new Promise((r) => setTimeout(r, CONFIG.descubrimientoGapMs));
  }
}

// ── Dedup ──────────────────────────────────────────────────────────────────
function comisionesDistintas(): Map<string, { materia: Materia; representantes: string[] }> {
  const map = new Map<string, { materia: Materia; representantes: string[] }>();
  for (const c of cuentas.values()) {
    for (const m of c.comisiones ?? []) {
      const k = claveComision(m);
      const e = map.get(k);
      if (e) e.representantes.push(c.legajo);
      else map.set(k, { materia: m, representantes: [c.legajo] });
    }
  }
  return map;
}

// ── Chequeo ────────────────────────────────────────────────────────────────
async function chequear(entry: { materia: Materia; representantes: string[] }) {
  for (const legajo of entry.representantes) {
    if (representanteRoto.has(legajo)) continue;
    const cookie = await sesionDe(legajo);
    if (!cookie) {
      representanteRoto.add(legajo);
      continue;
    }
    try {
      await esperarTurnoLegacy();
      const t0 = Date.now();
      const { page } = await fetchApplyLeave(cookie);
      metricas.registrarRt(Date.now() - t0);
      metricas.registrarPoll();
      if (!page.autenticado) {
        sesiones.delete(legajo);
        representanteRoto.add(legajo);
        continue;
      }
      const abiertas = (page.materias as Materia[]).filter((m) => m.habilitada);
      for (const m of abiertas) {
        const r = await fetch(`${CONFIG.appUrl}/api/webhooks/asistencia`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agent-secret": CONFIG.secret },
          body: JSON.stringify({ source: "asistencia-daemon", activeOptions: [{ id: m.id, name: m.nombre }] }),
        });
        const jr = (await r.json().catch(() => ({}))) as {
          materias?: { materia: string; enviado: boolean; sent?: number }[];
        };
        for (const x of jr.materias ?? []) {
          metricas.agregarMateria(x.materia);
          if (x.enviado && x.sent) metricas.sumarPushes(x.sent);
        }
      }
      return; // esta comisión ya quedó chequeada con este representante
    } catch (e) {
      metricas.registrarError(`chequear ${legajo}: ${String((e as Error).message).slice(0, 80)}`);
      representanteRoto.add(legajo);
    }
  }
}

let chequeosPendientes: ReturnType<typeof setTimeout>[] = [];
function cancelarChequeosPendientes() {
  for (const t of chequeosPendientes) clearTimeout(t);
  chequeosPendientes = [];
}

async function correrChequeos() {
  representanteRoto.clear();
  cancelarChequeosPendientes();
  const distintas = [...comisionesDistintas().values()];
  if (distintas.length === 0) return;
  const paso = Math.max(1000, Math.floor(CONFIG.chequeoVentanaMs / (distintas.length + 1)));
  distintas.forEach((entry, i) => {
    chequeosPendientes.push(setTimeout(() => void chequear(entry), i * paso));
  });
  console.log(`[${ts()}] chequeos: ${distintas.length} comisión(es), paso ${Math.round(paso / 1000)}s`);
}

// ── Heartbeat ──────────────────────────────────────────────────────────────
async function enviarHeartbeat(extra: Record<string, unknown> = {}) {
  if (!CONFIG.appUrl || !CONFIG.secret) return;
  try {
    await fetch(`${CONFIG.appUrl}/api/asistencia/worker/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": CONFIG.secret },
      body: JSON.stringify({
        id: CONFIG.workerId,
        estado: "activo",
        ...metricas.snapshot(),
        cuentas: cuentas.size,
        comisiones: comisionesDistintas().size,
        login_ok: ultimoLoginOk,
        ...extra,
      }),
    });
  } catch (e) {
    console.warn(`[${ts()}] heartbeat error: ${String((e as Error).message).slice(0, 100)}`);
  }
}

// ── Estado / control ──────────────────────────────────────────────────────
let corriendo = false;
let apagando = false;
let cuentasTimer: ReturnType<typeof setInterval> | null = null;
let chequeoTimer: ReturnType<typeof setInterval> | null = null;
let hbTimer: ReturnType<typeof setInterval> | null = null;

async function ciclo() {
  await refrescarCuentas();
  await correrDescubrimientosPendientes();
  await correrChequeos();
}

function pararTimers() {
  if (cuentasTimer) clearInterval(cuentasTimer);
  if (chequeoTimer) clearInterval(chequeoTimer);
  if (hbTimer) clearInterval(hbTimer);
  cuentasTimer = chequeoTimer = hbTimer = null;
  cancelarChequeosPendientes();
}

function arrancar() {
  if (apagando) return;
  if (corriendo) pararTimers(); // reinicio limpio
  corriendo = true;
  cuentasTimer = setInterval(() => void refrescarCuentas(), CONFIG.refrescoCuentasMs);
  chequeoTimer = setInterval(() => {
    void correrDescubrimientosPendientes();
    void correrChequeos();
  }, CONFIG.chequeoVentanaMs);
  hbTimer = setInterval(() => void enviarHeartbeat(), 10_000);
  console.log(`[${ts()}] worker '${CONFIG.workerId}' -> ${CONFIG.appUrl}  (corriendo)`);
  void ciclo();
  void enviarHeartbeat();
}

async function frenar(motivo: string) {
  pararTimers();
  corriendo = false;
  console.log(`[${ts()}] frenado (${motivo})`);
  await enviarHeartbeat({ estado: "apagado", motivo });
}

// ── Poll de comandos ──────────────────────────────────────────────────────
async function pollComandos() {
  if (!CONFIG.appUrl || !CONFIG.secret || apagando) return;
  try {
    const r = await fetch(
      `${CONFIG.appUrl}/api/asistencia/worker/comando?id=${encodeURIComponent(CONFIG.workerId)}`,
      { headers: { "x-worker-secret": CONFIG.secret }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return;
    const j = (await r.json()) as { cmd?: string | null; nonce?: string };
    if (!j.cmd || !j.nonce) return;
    console.log(`[${ts()}] comando: ${j.cmd}`);
    if (j.cmd === "frenar") await frenar("frenado desde el panel");
    else if (j.cmd === "arrancar" || j.cmd === "reiniciar") arrancar();
    await fetch(`${CONFIG.appUrl}/api/asistencia/worker/comando`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": CONFIG.secret },
      body: JSON.stringify({ id: CONFIG.workerId, nonce: j.nonce }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* reintenta en el próximo poll */
  }
}

// ── Arranque ──────────────────────────────────────────────────────────────
arrancar();
// NO unref: este interval mantiene vivo el proceso aunque esté frenado.
setInterval(() => void pollComandos(), 15_000);

async function cerrar(signal: string) {
  if (apagando) return;
  apagando = true;
  pararTimers();
  console.log(`[${ts()}] cerrando (${signal})`);
  await enviarHeartbeat({ estado: "apagado", motivo: "cierre manual" });
  process.exit(0);
}
process.on("SIGINT", () => void cerrar("SIGINT"));
process.on("SIGTERM", () => void cerrar("SIGTERM"));
