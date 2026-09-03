// Supervisor del worker del captcha remoto.
//
// - Levanta el tunel (cloudflared) y el worker (node server.mts), y los
//   reinicia si se caen (con backoff).
// - Hace polling de GET /api/captcha/comando?id=X cada 15s: si el admin encolo
//   un "reiniciar" / "frenar" / "arrancar" desde /admin/dashboard, lo ejecuta
//   y lo confirma con POST. Sin SSH, sin puertos abiertos.
//
// Lo lanza start.ps1 (o directamente: node supervisor.mts). Se corre con el TS
// nativo de Node 22.6+/24.
//
// Env (start.ps1 las setea):
//   CAPTCHA_WORKER_PORT   (default 8788)
//   CAPTCHA_APP_URL       base de la app (para comandos + que el worker mande heartbeat)
//   CAPTCHA_HEARTBEAT_SECRET
//   CAPTCHA_WORKER_NAME   (default: hostname)
//   CLOUDFLARED_PATH      ruta al binario
//   ...todo lo demas (CAPTCHA_MAX_SESIONES, CAPTCHA_POOL, etc.) se pasa al worker.

import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const PORT = process.env.CAPTCHA_WORKER_PORT || "8788";
const APP_URL = (process.env.CAPTCHA_APP_URL || "").replace(/\/$/, "");
const SECRET = process.env.CAPTCHA_HEARTBEAT_SECRET || "";
const WORKER_ID = (process.env.CAPTCHA_WORKER_NAME || os.hostname() || "worker").slice(0, 80);
const CF = process.env.CLOUDFLARED_PATH || "cloudflared";
const SERVER_MTS = path.join(import.meta.dirname, "server.mts");
const RX_URL = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/;

let tunel: ChildProcess | null = null;
let worker: ChildProcess | null = null;
let wssUrl = "";
let frenado = false;
let apagando = false;
let backoff = 2000;

function log(...a: unknown[]) {
  console.log("[sup]", ...a);
}

// Mata el proceso y su arbol (en Windows los nietos —Chromium— quedan huerfanos
// con un simple kill()).
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
          /* ya murio */
        }
      }, 3000);
    }
  } catch {
    /* nada */
  }
}

async function abrirTunel(): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(CF, ["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    tunel = p;
    let listo = false;
    const to = setTimeout(() => {
      if (!listo) reject(new Error("cloudflared no dio URL en 40s"));
    }, 40000);
    p.stderr?.on("data", (c: Buffer) => {
      const s = c.toString();
      const m = s.match(RX_URL);
      if (m && !listo) {
        listo = true;
        clearTimeout(to);
        resolve(`wss://${m[1]}`);
      }
    });
    p.on("exit", (code) => {
      if (!listo) {
        clearTimeout(to);
        reject(new Error(`cloudflared salio (${code})`));
      } else if (!apagando && !frenado) {
        log("tunel cayo, reinicio ciclo");
        reiniciarCiclo();
      }
    });
  });
}

function abrirWorker(url: string) {
  const p = spawn(process.execPath, [SERVER_MTS], {
    stdio: "inherit",
    env: { ...process.env, CAPTCHA_WORKER_WSS_URL: url, CAPTCHA_WORKER_NAME: WORKER_ID },
  });
  worker = p;
  p.on("exit", (code, sig) => {
    if (apagando || frenado) return;
    log(`worker salio (code=${code} sig=${sig}), reinicio en ${backoff}ms`);
    setTimeout(reiniciarCiclo, backoff);
    backoff = Math.min(backoff * 2, 30000);
  });
}

let reiniciando = false;
async function reiniciarCiclo() {
  if (apagando || reiniciando) return;
  reiniciando = true;
  try {
    matarArbol(worker);
    matarArbol(tunel);
    worker = null;
    tunel = null;
    await new Promise((r) => setTimeout(r, 1000));
    if (frenado || apagando) return;
    wssUrl = await abrirTunel();
    log("tunel:", wssUrl);
    abrirWorker(wssUrl);
    backoff = 2000;
    log("worker arrancado");
  } catch (e) {
    log("fallo el ciclo:", String((e as Error).message || e), "- reintento en 5s");
    setTimeout(reiniciarCiclo, 5000);
  } finally {
    reiniciando = false;
  }
}

// ── Comandos remotos ───────────────────────────────────────────────────────
async function pollComandos() {
  if (!APP_URL || !SECRET || apagando) return;
  try {
    const r = await fetch(
      `${APP_URL}/api/captcha/comando?id=${encodeURIComponent(WORKER_ID)}`,
      { headers: { "x-worker-secret": SECRET }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return;
    const j = (await r.json()) as { cmd?: string | null; nonce?: string };
    if (!j.cmd || !j.nonce) return;
    log("comando recibido:", j.cmd);
    if (j.cmd === "frenar") {
      frenado = true;
      matarArbol(worker);
      matarArbol(tunel);
      worker = null;
      tunel = null;
    } else if (j.cmd === "arrancar") {
      frenado = false;
      void reiniciarCiclo();
    } else if (j.cmd === "reiniciar") {
      frenado = false;
      void reiniciarCiclo();
    }
    // ACK
    await fetch(`${APP_URL}/api/captcha/comando`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": SECRET },
      body: JSON.stringify({ id: WORKER_ID, nonce: j.nonce }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* reintenta en el proximo poll */
  }
}

// ── Arranque ───────────────────────────────────────────────────────────────
log(`supervisor de '${WORKER_ID}'  puerto=${PORT}  comandos=${APP_URL && SECRET ? "ON" : "OFF"}`);
void reiniciarCiclo();
setInterval(() => void pollComandos(), 15000).unref?.();

const cerrar = () => {
  if (apagando) return;
  apagando = true;
  log("cerrando...");
  matarArbol(worker);
  matarArbol(tunel);
  setTimeout(() => process.exit(0), 1500);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
