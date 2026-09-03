// Handler del protocolo del captcha remoto, compartido por:
//   - la ruta serverless de Vercel (app/api/captcha/route.ts)
//   - el worker standalone que corre en una PC de casa
//     (scripts/captcha-remoto/server.mts)
//
// Protocolo (JSON):
//   C→S: {type:"iniciar"} | {type:"clic-checkbox"} | {type:"clic-tile",nx,ny}
//        | {type:"verificar"} | {type:"recargar"} | {type:"abortar"}
//   S→C: {type:"iniciado"} | {type:"estado",fase,...} | {type:"error",mensaje}
//        | {type:"diag",paso,detalle,t}
//   fases: listo | verificando | desafio{texto,filas,imgs,celdas} |
//          resuelto{token} | abortado | error-widget{mensaje}

// Usado solo por la ruta de Vercel (app/api/captcha/route.ts). El worker
// standalone (scripts/captcha-remoto/server.mts) tiene su propia copia del
// switch para poder correr con el TS nativo de Node sin pasar por el bundler.
import { SesionCaptcha } from "./captchaSesion";

type Enviar = (obj: Record<string, unknown>) => void;

export type CaptchaHandler = {
  manejar: (data: unknown) => Promise<void>;
  cerrar: () => Promise<void>;
};

// `send` debe serializar y mandar por el WS (o no-op si está cerrado).
export function crearCaptchaHandler(send: Enviar): CaptchaHandler {
  let sesion: SesionCaptcha | null = null;

  return {
    async manejar(data: unknown) {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      console.log(
        "[captcha] C->S",
        msg.type,
        msg.type === "clic-tile" ? { nx: msg.nx, ny: msg.ny } : ""
      );
      try {
        switch (msg.type) {
          case "iniciar": {
            // El cupo / la cola los maneja sesion.iniciar() (emite "en-cola"
            // mientras espera).
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
    },

    async cerrar() {
      await sesion?.cerrar();
      sesion = null;
    },
  };
}
