"use client";

// Espejo del captcha remoto: se conecta por WS a la sesión headless, replica el
// checkbox y el desafío de imágenes, y devuelve el token al resolverlo.
//
// El server serializa la grilla real celda por celda (espejo DOM puro, sin
// screenshots) y re-emite solo cuando la firma del DOM cambia — todo disparado
// por eventos del MutationObserver del widget real. La selección es
// local-optimista; si la imagen de una celda cambia en el widget real, esa
// celda se limpia (nueva tile = deseleccionada).
//
// El widget que se ve acá es un clon visual (no funcional) del reCAPTCHA de
// Google, manejado por el estado que llega por WSS.

import { useEffect, useRef, useState } from "react";

type CeldaDom = { i: number; pos: string; size: string } | null;

type Estado =
  | { fase: "conectando" }
  | { fase: "iniciando" }
  | { fase: "listo" }
  | { fase: "verificando"; texto?: string }
  | {
      fase: "desafio";
      texto: string;
      filas: number;
      imgs: string[];
      celdas: CeldaDom[];
    }
  | { fase: "resuelto" }
  | { fase: "error"; mensaje: string };

type MensajeServidor = {
  type: string;
  fase?: string;
  texto?: string;
  filas?: number;
  imgs?: string[];
  celdas?: CeldaDom[];
  token?: string;
  mensaje?: string;
};

function wsUrl(): string {
  const custom = process.env.NEXT_PUBLIC_CAPTCHA_WS_URL;
  if (custom) return custom;
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  return proto + location.host + "/api/captcha";
}

// Recreación simple del logo de reCAPTCHA: dos flechas curvas formando un
// círculo, en el azul de Google.
function LogoRecaptcha() {
  return (
    <svg viewBox="0 0 40 40" className="w-8 h-8" aria-hidden="true" fill="none">
      <path
        d="M20 6V1l-7 6 7 6V8a12 12 0 0 1 10.7 6.6l2.5-1.5A15 15 0 0 0 20 6Z"
        fill="#1c3aa9"
      />
      <path
        d="M20 32a12 12 0 0 1-10.7-6.6l-2.5 1.5A15 15 0 0 0 20 34v5l7-6-7-6v6Z"
        fill="#4285f4"
      />
      <path
        d="M8 20c0-2.2.6-4.3 1.6-6.1L7.1 12.4A15 15 0 0 0 5 20c0 1 .1 2 .3 3l2.9-.8C8.1 21.5 8 20.8 8 20Z"
        fill="#9aa0a6"
      />
    </svg>
  );
}

export default function CaptchaRemoto({
  onResuelto,
  onCancelar,
}: {
  onResuelto: (token: string) => void;
  onCancelar: () => void;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "conectando" });
  const [seleccionadas, setSeleccionadas] = useState<Set<number>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const prevCeldas = useRef<CeldaDom[]>([]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: "iniciar" }));
    ws.onmessage = (ev) => {
      const m: MensajeServidor = JSON.parse(ev.data);
      if (m.type === "error") {
        setEstado({ fase: "error", mensaje: m.mensaje || "Error del servidor" });
        return;
      }
      if (m.type !== "estado") return;
      switch (m.fase) {
        case "listo":
          setEstado({ fase: "listo" });
          break;
        case "verificando":
          setEstado((prev) =>
            prev.fase === "desafio" ? prev : { fase: "verificando", texto: m.mensaje }
          );
          break;
        case "desafio": {
          // Merge — conservar selección solo en celdas cuya firma (img + pos +
          // size) no cambió (tile reemplazada = deseleccionada; celda null =
          // consumida).
          const celdas = m.celdas ?? [];
          setSeleccionadas((prev) => {
            const nuevas = new Set<number>();
            celdas.forEach((c, idx) => {
              const prevC = prevCeldas.current[idx];
              if (c && prevC && c.i === prevC.i && c.pos === prevC.pos && prev.has(idx)) {
                nuevas.add(idx);
              }
            });
            return nuevas;
          });
          prevCeldas.current = celdas;
          setEstado({
            fase: "desafio",
            texto: m.texto || "",
            filas: m.filas || 3,
            imgs: m.imgs ?? [],
            celdas,
          });
          break;
        }
        case "resuelto":
          setEstado({ fase: "resuelto" });
          if (m.token) onResuelto(m.token);
          break;
        case "abortado":
          setEstado({ fase: "error", mensaje: "Sesión cerrada." });
          break;
        case "error-widget":
          setEstado((prev) => (prev.fase === "desafio" ? prev : { fase: "listo" }));
          break;
      }
    };
    ws.onerror = () => {
      setEstado({
        fase: "error",
        mensaje:
          "No se pudo conectar con el servicio de captcha. Verificá tu conexión e intentá de nuevo.",
      });
    };

    return () => {
      try {
        ws.send(JSON.stringify({ type: "abortar" }));
      } catch {
        /* ya cerrado */
      }
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (obj: Record<string, unknown>) => wsRef.current?.send(JSON.stringify(obj));

  const clicCheckbox = () => {
    setEstado({ fase: "verificando" });
    send({ type: "clic-checkbox" });
  };

  const verificar = () => {
    setEstado((prev) =>
      prev.fase === "desafio"
        ? { fase: "verificando", texto: "Puede venir otra ronda de imágenes" }
        : prev
    );
    send({ type: "verificar" });
  };

  const recargar = () => {
    setEstado({ fase: "verificando", texto: "Buscando otro desafío..." });
    send({ type: "recargar" });
  };

  // Clic sobre una celda de la grilla DOM: selección local optimista + clic
  // remoto al centro exacto de esa tile.
  const clicCelda = (idx: number, filas: number) => {
    setSeleccionadas((prev) => {
      const nuevas = new Set(prev);
      if (nuevas.has(idx)) nuevas.delete(idx);
      else nuevas.add(idx);
      return nuevas;
    });
    const col = idx % filas;
    const row = Math.floor(idx / filas);
    send({ type: "clic-tile", nx: (col + 0.5) / filas, ny: (row + 0.5) / filas });
  };

  const cargando =
    estado.fase === "conectando" || estado.fase === "iniciando" || estado.fase === "verificando";

  return (
    <div className="rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] p-6 mb-6 flex flex-col items-center text-center">
      <h2 className="text-[16px] font-semibold text-[var(--fg)] mb-1">Verificación de seguridad</h2>
      {estado.fase !== "resuelto" && (
        <p className="text-[12px] text-[#ff9500] mb-4 max-w-[304px]">
          Al resolver el captcha se pedirá el turno automáticamente con los datos del formulario.
        </p>
      )}

      {/* ── Clon del widget anchor de reCAPTCHA (se oculta durante el desafío) ── */}
      {estado.fase !== "desafio" && (
      <div
        onClick={estado.fase === "listo" ? clicCheckbox : undefined}
        className={`flex items-center gap-3 w-full max-w-[304px] rounded-[3px] border border-[#d3d3d3] bg-[#f9f9f9] px-3 py-3 shadow-[0_0_4px_1px_rgba(0,0,0,0.08)] select-none text-left ${
          estado.fase === "listo" ? "cursor-pointer" : ""
        }`}
        role="checkbox"
        aria-checked={estado.fase === "resuelto"}
      >
        <span
          className={`relative w-[28px] h-[28px] rounded-[2px] bg-white grid place-items-center ${
            estado.fase === "resuelto"
              ? "border-2 border-[#1c3aa9]"
              : "border-2 border-[#c1c1c1]"
          }`}
        >
          {estado.fase === "resuelto" && (
            <svg viewBox="0 0 24 24" className="w-5 h-5">
              <path
                fill="none"
                stroke="#1c3aa9"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 12.5 10 18 20 6"
              />
            </svg>
          )}
          {cargando && (
            <span className="w-4 h-4 border-2 border-[#c1c1c1] border-t-[#4285f4] rounded-full animate-spin" />
          )}
        </span>

        <span className="flex-1 text-[14px] text-[#000] leading-none">No soy un robot</span>

        <span className="flex flex-col items-center text-[#9aa0a6]">
          <LogoRecaptcha />
          <span className="text-[10px] leading-tight mt-0.5">reCAPTCHA</span>
          <span className="text-[8px] leading-tight">Privacidad · Términos</span>
        </span>
      </div>
      )}

      {/* Texto de estado bajo el checkbox */}
      {cargando && (
        <p className="text-[12px] text-[var(--secondary)] mt-2 max-w-[304px]">
          {estado.fase === "conectando"
            ? "Conectando con el sistema de turnos..."
            : estado.fase === "iniciando"
            ? "Abriendo navegador remoto..."
            : estado.texto || "Verificando... puede venir otra ronda de imágenes"}
        </p>
      )}

      {/* ── Panel del desafío de imágenes ───────────────────────────────── */}
      {estado.fase === "desafio" && (
        <div className="mt-3 w-full max-w-[304px] rounded-[3px] border border-[#ccc] bg-white overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.15)] text-left">
          <div className="bg-[#1a73e8] text-white px-4 pt-3 pb-4">
            <p className="text-[15px] leading-tight">{estado.texto}</p>
          </div>

          <div
            className="grid w-full gap-[3px] bg-white p-[3px]"
            style={{ gridTemplateColumns: `repeat(${estado.filas}, minmax(0, 1fr))` }}
          >
            {estado.celdas.map((c, idx) =>
              c ? (
                <div
                  key={idx}
                  className="relative aspect-square cursor-pointer select-none overflow-hidden"
                  onClick={() => clicCelda(idx, estado.filas)}
                >
                  <div
                    className="absolute inset-0 bg-no-repeat transition-transform duration-150"
                    style={{
                      backgroundImage: `url("${estado.imgs[c.i] ?? ""}")`,
                      backgroundPosition: c.pos,
                      backgroundSize: c.size,
                      transform: seleccionadas.has(idx) ? "scale(0.87)" : "none",
                    }}
                  />
                  {seleccionadas.has(idx) && (
                    <span className="absolute inset-0 grid place-items-center bg-white/25 pointer-events-none">
                      <span className="w-7 h-7 rounded-full bg-[#1a73e8] grid place-items-center">
                        <svg viewBox="0 0 24 24" className="w-4 h-4">
                          <path
                            fill="none"
                            stroke="#fff"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4 12.5 10 18 20 6"
                          />
                        </svg>
                      </span>
                    </span>
                  )}
                </div>
              ) : (
                <div
                  key={idx}
                  className="aspect-square grid place-items-center bg-[#e8eaed]"
                >
                  <span className="w-6 h-6 rounded-full bg-[#9aa0a6] grid place-items-center">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5">
                      <path
                        fill="none"
                        stroke="#fff"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 12.5 10 18 20 6"
                      />
                    </svg>
                  </span>
                </div>
              )
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-[#eee] px-3 py-2">
            <button
              type="button"
              title="Otro desafío"
              onClick={recargar}
              className="text-[18px] text-[#9aa0a6] hover:text-[#5f6368] leading-none"
            >
              ↻
            </button>
            <button
              type="button"
              onClick={verificar}
              className="ml-auto bg-[#1a73e8] hover:bg-[#1765cc] text-white text-[13px] font-medium px-5 py-2 rounded-[2px] active:scale-95 transition"
            >
              VERIFICAR
            </button>
          </div>
          <p className="text-[11px] text-[#9aa0a6] px-3 pb-2.5">
            Puede haber varias rondas: seleccioná y apretá VERIFICAR hasta que la casilla se tilde sola.
          </p>
        </div>
      )}

      {/* error */}
      {estado.fase === "error" && (
        <div className="mt-3 w-full max-w-[304px] rounded-xl border border-[#ff3b30]/30 bg-[#ff3b30]/10 p-3 text-left">
          <p className="text-[13px] text-[#ff3b30]">{estado.mensaje}</p>
          <button
            type="button"
            onClick={onCancelar}
            className="mt-2 text-[13px] text-[var(--fg)] underline hover:no-underline"
          >
            Volver al formulario
          </button>
        </div>
      )}

      {estado.fase !== "error" && (
        <button
          type="button"
          onClick={() => {
            send({ type: "abortar" });
            onCancelar();
          }}
          className="block mt-4 text-[13px] text-[var(--secondary)] underline hover:text-[var(--fg)]"
        >
          Cancelar verificación
        </button>
      )}
    </div>
  );
}
