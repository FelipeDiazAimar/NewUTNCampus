// Worker standalone del captcha remoto - corre en una PC de casa.
//
// Por que: reCAPTCHA mete a la sesion en un bucle infinito de desafios 4x4
// cuando la peticion sale desde la IP de datacenter de Vercel. Corriendo el
// Chromium ACA, sale por la IP residencial de esta PC (sin proxy), y por el
// tunel (cloudflared) viaja solo este WebSocket - JSON + imagenes de tiles,
// unos cientos de KB - no todo el trafico de Google.
//
// Se corre con el TypeScript nativo de Node 24+ (node server.mts): borra los
// tipos sin transformar el codigo, asi las funciones que van a page.evaluate()
// llegan intactas al navegador. Con tsx/esbuild se rompian (ReferenceError:
// __name is not defined).
//
// start.ps1 hace: node server.mts + el tunel + imprime las env vars.
//
// Heartbeat: cada 10s POSTea sus metricas a CAPTCHA_APP_URL/api/captcha/heartbeat
// con el header x-worker-secret = CAPTCHA_HEARTBEAT_SECRET. Eso alimenta el
// monitor de /admin/dashboard y el endpoint runtime GET /api/captcha/endpoint
// (asi el cliente toma la wss_url sola, sin reconfigurar Vercel en cada
// reinicio del tunel).

import os from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import {
  SesionCaptcha,
  cerrarNavegadorCompartido,
  iniciarPool,
  estadoInterno,
} from "../../lib/captchaSesion.ts";
import { metricas } from "../../lib/captchaMetricas.ts";

const PORT = Number(process.env.CAPTCHA_WORKER_PORT || 8788);
const TOKEN = process.env.CAPTCHA_WORKER_TOKEN || "";
const ORIGENES = (process.env.CAPTCHA_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const WORKER_ID = (process.env.CAPTCHA_WORKER_NAME || os.hostname() || "worker").slice(0, 80);
const APP_URL = (process.env.CAPTCHA_APP_URL || "").replace(/\/$/, "");
const HB_SECRET = process.env.CAPTCHA_HEARTBEAT_SECRET || "";

const wss = new WebSocketServer({ port: PORT, maxPayload: 4 * 1024 });

// ── Heartbeat ───────────────────────────────────────────────────────────────
async function enviarHeartbeat(extra: Record<string, unknown> = {}): Promise<void> {
  if (!APP_URL || !HB_SECRET) return;
  const cuerpo = {
    id: WORKER_ID,
    estado: "activo",
    ...metricas.snapshot(estadoInterno()),
    ...extra,
  };
  try {
    const ctrl = AbortSignal.timeout(8000);
    const res = await fetch(`${APP_URL}/api/captcha/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": HB_SECRET },
      body: JSON.stringify(cuerpo),
      signal: ctrl,
    });
    if (!res.ok) console.warn("[worker] heartbeat", res.status, (await res.text()).slice(0, 120));
  } catch (e) {
    console.warn("[worker] heartbeat error:", String((e as Error).message || e).slice(0, 100));
  }
}

let hbInterval: ReturnType<typeof setInterval> | null = null;

wss.on("listening", () => {
  console.log(`[worker] escuchando ws://127.0.0.1:${PORT}  id=${WORKER_ID}`);
  console.log(
    `[worker] token=${TOKEN ? "si" : "NO (abierto)"}  origenes=${ORIGENES.length ? ORIGENES.join(",") : "cualquiera"}` +
      `  heartbeat=${APP_URL && HB_SECRET ? APP_URL : "OFF"}`
  );
  iniciarPool(); // no-op si CAPTCHA_POOL no está seteado
  if (APP_URL && HB_SECRET) {
    void enviarHeartbeat();
    hbInterval = setInterval(() => void enviarHeartbeat(), 10000);
    hbInterval.unref?.();
  }
});

wss.on("connection", (ws: WebSocket, req) => {
  const url = new URL(req.url || "/", "http://x");
  const token = url.searchParams.get("token") || "";
  const origin = req.headers.origin || "";

  if (TOKEN && token !== TOKEN) {
    console.warn("[worker] rechazado: token invalido", origin);
    ws.close(1008, "token invalido");
    return;
  }
  if (ORIGENES.length && origin && !ORIGENES.includes(origin)) {
    console.warn("[worker] rechazado: origin no permitido", origin);
    ws.close(1008, "origin no permitido");
    return;
  }

  console.log("[worker] conexion OK", origin || "(sin origin)");
  metricas.conexAbierta();

  let tIniciar = 0;
  const send = (obj: Record<string, unknown>) => {
    if (obj.type === "estado" && obj.fase === "listo" && tIniciar) {
      metricas.registrarRt(Date.now() - tIniciar);
      tIniciar = 0;
    }
    if (obj.type === "error") metricas.registrarError(String(obj.mensaje || ""));
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  let sesion: SesionCaptcha | null = null;

  ws.on("message", async (data) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    console.log("[captcha] C->S", msg.type, msg.type === "clic-tile" ? { nx: msg.nx, ny: msg.ny } : "");
    try {
      switch (msg.type) {
        case "iniciar": {
          tIniciar = Date.now();
          // El cupo / la cola los maneja sesion.iniciar() (emite "en-cola").
          sesion = new SesionCaptcha(send);
          send({ type: "iniciado" });
          await sesion.iniciar();
          break;
        }
        case "clic-checkbox":
          await sesion?.clicCheckbox();
          break;
        case "clic-tile":
          await sesion?.clicEnDesafio(Number(msg.nx), Number(msg.ny));
          break;
        case "verificar":
          await sesion?.verificar();
          break;
        case "recargar":
          await sesion?.recargar();
          break;
        case "abortar":
          await sesion?.cerrar();
          sesion = null;
          send({ type: "estado", fase: "abortado" });
          break;
      }
    } catch (e) {
      const mensaje = String((e as Error).message || e);
      console.error("[captcha] handler ERROR en", msg.type, "-", mensaje);
      send({ type: "diag", paso: `handler:ERROR:${msg.type}`, detalle: mensaje, t: Date.now() });
      send({ type: "error", mensaje });
    }
  });

  ws.on("close", () => {
    console.log("[worker] conexion cerrada");
    metricas.conexCerrada();
    void sesion?.cerrar();
    sesion = null;
  });
  ws.on("error", (e) => console.warn("[worker] ws error", String(e)));
});

let cerrando = false;
const cerrar = () => {
  if (cerrando) return;
  cerrando = true;
  console.log("\n[worker] cerrando...");
  if (hbInterval) clearInterval(hbInterval);
  void cerrarNavegadorCompartido();
  // Aviso final al monitor (best-effort, con tope de tiempo).
  void enviarHeartbeat({ estado: "apagado", motivo: "cierre manual" }).finally(() => {
    wss.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
  setTimeout(() => process.exit(0), 4000);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
