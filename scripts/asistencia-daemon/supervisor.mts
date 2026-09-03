// Supervisor del daemon de asistencia.
//
// - Levanta daemon.mts y lo reinicia si se cae (con backoff).
// - Cada 15s hace polling de GET /api/asistencia/worker/comando?id=X: si el
//   admin encoló "reiniciar" / "frenar" / "arrancar" desde /admin/dashboard, lo
//   ejecuta y lo confirma con POST. Sin SSH, sin puertos abiertos.
//
// Lo lanza start.ps1. Calco de scripts/captcha-remoto/supervisor.mts sin la
// parte del túnel (el daemon llama de salida, no necesita entrada).

import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const APP_URL = (process.env.CAMPUS_APP_URL || "").replace(/\/$/, "");
const SECRET = process.env.NOTIFICATIONS_WEBHOOK_SECRET || "";
const WORKER_ID = (process.env.ASISTENCIA_WORKER_NAME || os.hostname() || "asistencia-daemon").slice(
  0,
  80
);
const DAEMON_MTS = path.join(import.meta.dirname, "daemon.mts");

let daemon: ChildProcess | null = null;
let frenado = false;
let apagando = false;
let backoff = 2000;

function log(...a: unknown[]) {
  console.log("[sup]", ...a);
}

function matarArbol(p: ChildProcess | null) {
  if (!p || p.exitCode !== null || p.pid == null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      p.kill("SIGTERM");
      setTimeout(() => {
        try {
          p.kill("SIGKILL");
        } catch {
          /* ya murió */
        }
      }, 3000);
    }
  } catch {
    /* nada */
  }
}

function abrirDaemon() {
  const p = spawn(process.execPath, [DAEMON_MTS], {
    stdio: "inherit",
    env: { ...process.env, ASISTENCIA_WORKER_NAME: WORKER_ID },
  });
  daemon = p;
  p.on("exit", (code, sig) => {
    // Ignorar el exit de un hijo que ya fue reemplazado / matado a propósito
    // (reiniciarCiclo y frenar ponen daemon=null antes de que llegue este exit).
    // Sin esto, un comando dispara reiniciarCiclo Y el exit del daemon viejo
    // agenda otro reiniciarCiclo -> bucle de reinicio.
    if (p !== daemon) return;
    if (apagando || frenado) return;
    log(`daemon salió (code=${code} sig=${sig}), reinicio en ${backoff}ms`);
    daemon = null;
    setTimeout(reiniciarCiclo, backoff);
    backoff = Math.min(backoff * 2, 30000);
  });
}

let reiniciando = false;
function reiniciarCiclo() {
  if (apagando || reiniciando) return;
  reiniciando = true;
  try {
    matarArbol(daemon);
    daemon = null;
    setTimeout(() => {
      if (!frenado && !apagando) {
        abrirDaemon();
        backoff = 2000;
        log("daemon arrancado");
      }
      reiniciando = false;
    }, 1000);
  } catch (e) {
    log("fallo el ciclo:", String((e as Error).message || e));
    reiniciando = false;
    setTimeout(reiniciarCiclo, 5000);
  }
}

async function pollComandos() {
  if (!APP_URL || !SECRET || apagando) return;
  try {
    const r = await fetch(
      `${APP_URL}/api/asistencia/worker/comando?id=${encodeURIComponent(WORKER_ID)}`,
      { headers: { "x-worker-secret": SECRET }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return;
    const j = (await r.json()) as { cmd?: string | null; nonce?: string };
    if (!j.cmd || !j.nonce) return;
    log("comando recibido:", j.cmd);
    if (j.cmd === "frenar") {
      frenado = true;
      matarArbol(daemon);
      daemon = null;
    } else if (j.cmd === "arrancar" || j.cmd === "reiniciar") {
      frenado = false;
      reiniciarCiclo();
    }
    await fetch(`${APP_URL}/api/asistencia/worker/comando`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": SECRET },
      body: JSON.stringify({ id: WORKER_ID, nonce: j.nonce }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* reintenta en el próximo poll */
  }
}

log(`supervisor de '${WORKER_ID}'  comandos=${APP_URL && SECRET ? "ON" : "OFF"}`);
reiniciarCiclo();
setInterval(() => void pollComandos(), 15000).unref?.();

const cerrar = () => {
  if (apagando) return;
  apagando = true;
  log("cerrando...");
  matarArbol(daemon);
  setTimeout(() => process.exit(0), 1500);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
