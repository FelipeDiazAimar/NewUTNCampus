// Worker standalone del captcha remoto — corre en una PC de casa.
//
// Por qué: reCAPTCHA mete a la sesión en un bucle infinito de desafíos 4x4
// cuando la petición sale desde la IP de datacenter de Vercel. Corriendo el
// Chromium ACÁ, sale por la IP residencial de esta PC (sin proxy), y por el
// túnel (cloudflared) viaja solo este WebSocket — JSON + imágenes de tiles,
// unos cientos de KB — no todo el tráfico de Google.
//
// Levantar con:  npx tsx scripts/captcha-remoto/server.mts
// (start.ps1 hace esto + el túnel + imprime las env vars para Vercel)
//
// El cliente (components/biblioteca/CaptchaRemoto.tsx) apunta acá vía
// NEXT_PUBLIC_CAPTCHA_WS_URL y manda ?token=NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN.

import { WebSocketServer, type WebSocket } from "ws";
import { crearCaptchaHandler } from "../../lib/captchaHandler";

const PORT = Number(process.env.CAPTCHA_WORKER_PORT || 8788);
const TOKEN = process.env.CAPTCHA_WORKER_TOKEN || "";
// Lista separada por coma de orígenes permitidos (las URLs de la app en
// Vercel). Vacío = cualquiera (solo para probar en local).
const ORIGENES = (process.env.CAPTCHA_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const wss = new WebSocketServer({ port: PORT, maxPayload: 4 * 1024 });

wss.on("listening", () => {
  console.log(`[worker] escuchando ws://127.0.0.1:${PORT}`);
  console.log(`[worker] token=${TOKEN ? "sí" : "NO (abierto)"}  origenes=${ORIGENES.length ? ORIGENES.join(",") : "cualquiera"}`);
});

wss.on("connection", (ws: WebSocket, req) => {
  const url = new URL(req.url || "/", "http://x");
  const token = url.searchParams.get("token") || "";
  const origin = req.headers.origin || "";

  if (TOKEN && token !== TOKEN) {
    console.warn("[worker] rechazado: token inválido", origin);
    ws.close(1008, "token inválido");
    return;
  }
  if (ORIGENES.length && origin && !ORIGENES.includes(origin)) {
    console.warn("[worker] rechazado: origin no permitido", origin);
    ws.close(1008, "origin no permitido");
    return;
  }

  console.log("[worker] conexión OK", origin || "(sin origin)");
  const send = (obj: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };
  const handler = crearCaptchaHandler(send);
  ws.on("message", (data) => void handler.manejar(data));
  ws.on("close", () => {
    console.log("[worker] conexión cerrada");
    void handler.cerrar();
  });
  ws.on("error", (e) => console.warn("[worker] ws error", String(e)));
});

const cerrar = () => {
  console.log("\n[worker] cerrando...");
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
