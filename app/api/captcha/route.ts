// Ruta WebSocket del captcha remoto.
//
// Una conexión WS = una SesionCaptcha (Chromium headless en la memoria de la
// instancia). Vercel pinnea cada conexión a una instancia (Fluid compute), y
// la instancia puede atender varias conexiones — por eso hay tope de sesiones
// simultáneas.
//
// SOLO funciona en Vercel (o `vc dev`); el upgrade WS no existe en `next dev`.
// Se prueba deployando a un preview de Vercel.
//
// Esta ruta solo reenvía: la SesionCaptcha detecta los cambios del widget por
// evento (MutationObserver en los iframes del reCAPTCHA) y empuja el estado.
//
// Protocolo (JSON):
//   C→S: {type:"iniciar"} | {type:"clic-checkbox"} | {type:"clic-tile",nx,ny}
//        | {type:"verificar"} | {type:"recargar"} | {type:"abortar"}
//   S→C: {type:"iniciado"} | {type:"estado",fase,...} | {type:"error",mensaje}
//   fases: listo | verificando | desafio{texto,filas,imgs,celdas} |
//          resuelto{token} | abortado | error-widget{mensaje}

import { experimental_upgradeWebSocket, type WebSocketData } from "@vercel/functions";
import { WebSocket } from "ws";
import { SesionCaptcha, MAX_SESIONES_CAPTCHA } from "@/lib/captchaSesion";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PAYLOAD = 4 * 1024; // los mensajes del cliente son JSONs chicos

function tieneSesionApp(req: Request): boolean {
  const cookie = req.headers.get("cookie") || "";
  return /moodle_user=|sysacadws_auth=/.test(cookie);
}

export async function GET(req: Request) {
  // Solo usuarios autenticados de la app pueden usar el headless como solver.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  const originOk = !origin || (host && new URL(origin).host === host);
  if (!tieneSesionApp(req) || !originOk) {
    return new Response("No autorizado", { status: 401 });
  }

  return experimental_upgradeWebSocket((ws: WebSocket) => {
    let sesion: SesionCaptcha | null = null;

    const send = (obj: Record<string, unknown>) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    };

    ws.on("message", async (data: WebSocketData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      try {
        switch (msg.type) {
          case "iniciar": {
            if (!SesionCaptcha.cupoDisponible) {
              send({
                type: "error",
                mensaje: `Hay ${MAX_SESIONES_CAPTCHA} sesiones activas. Esperá un momento.`,
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
        send({ type: "error", mensaje: String((e as Error).message || e) });
      }
    });

    ws.on("close", async () => {
      await sesion?.cerrar();
      sesion = null;
    });
  }, { maxPayload: MAX_PAYLOAD });
}
