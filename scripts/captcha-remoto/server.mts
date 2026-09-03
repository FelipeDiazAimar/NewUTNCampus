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
// El cliente (components/biblioteca/CaptchaRemoto.tsx) apunta aca via
// NEXT_PUBLIC_CAPTCHA_WS_URL y manda ?token=NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN.

import { WebSocketServer, type WebSocket } from "ws";
import {
  SesionCaptcha,
  MAX_SESIONES_CAPTCHA,
  cerrarNavegadorCompartido,
} from "../../lib/captchaSesion.ts";

const PORT = Number(process.env.CAPTCHA_WORKER_PORT || 8788);
const TOKEN = process.env.CAPTCHA_WORKER_TOKEN || "";
const ORIGENES = (process.env.CAPTCHA_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const wss = new WebSocketServer({ port: PORT, maxPayload: 4 * 1024 });

wss.on("listening", () => {
  console.log(`[worker] escuchando ws://127.0.0.1:${PORT}`);
  console.log(
    `[worker] token=${TOKEN ? "si" : "NO (abierto)"}  origenes=${ORIGENES.length ? ORIGENES.join(",") : "cualquiera"}`
  );
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
  const send = (obj: Record<string, unknown>) => {
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
          if (!SesionCaptcha.cupoDisponible) {
            send({
              type: "error",
              mensaje: `Hay ${MAX_SESIONES_CAPTCHA} sesiones activas. Espera un momento.`,
            });
            return;
          }
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
    void sesion?.cerrar();
    sesion = null;
  });
  ws.on("error", (e) => console.warn("[worker] ws error", String(e)));
});

const cerrar = () => {
  console.log("\n[worker] cerrando...");
  void cerrarNavegadorCompartido();
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
