"use client";

// Espejo del captcha remoto: se conecta por WS a la sesión headless, replica el
// checkbox y el desafío de imágenes, y devuelve el token al resolverlo.
// Comportamiento validado en scripts/captcha-remoto (31/08/2026).

import { useEffect, useRef, useState } from "react";

type Estado =
  | { fase: "conectando" }
  | { fase: "iniciando" }
  | { fase: "listo" }
  | { fase: "verificando"; texto?: string }
  | { fase: "desafio"; imagen: string; texto: string; filas: number }
  | { fase: "resuelto" }
  | { fase: "error"; mensaje: string };

type MensajeServidor = {
  type: string;
  fase?: string;
  imagen?: string;
  texto?: string;
  filas?: number;
  token?: string;
  mensaje?: string;
};

function wsUrl(): string {
  const custom = process.env.NEXT_PUBLIC_CAPTCHA_WS_URL;
  if (custom) return custom;
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  return proto + location.host + "/api/captcha";
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
          setEstado({ fase: "verificando", texto: m.mensaje });
          break;
        case "desafio":
          setSeleccionadas(new Set());
          setEstado({ fase: "desafio", imagen: m.imagen!, texto: m.texto!, filas: m.filas || 3 });
          break;
        case "resuelto":
          setEstado({ fase: "resuelto" });
          if (m.token) onResuelto(m.token);
          break;
        case "abortado":
          setEstado({ fase: "error", mensaje: "Sesión cerrada." });
          break;
        case "error-widget":
          setEstado({ fase: "listo" });
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
    setSeleccionadas(new Set());
    setEstado({ fase: "verificando", texto: "Puede venir otra ronda de imágenes" });
    send({ type: "verificar" });
  };

  const recargar = () => {
    setSeleccionadas(new Set());
    setEstado({ fase: "verificando", texto: "Buscando otro desafío..." });
    send({ type: "recargar" });
  };

  const clicTile = (e: React.MouseEvent<HTMLImageElement>) => {
    if (estado.fase !== "desafio") return;
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.min(estado.filas - 1, Math.floor(((e.clientX - r.left) / r.width) * estado.filas));
    const row = Math.min(estado.filas - 1, Math.floor(((e.clientY - r.top) / r.height) * estado.filas));
    const idx = row * estado.filas + col;

    const nuevas = new Set(seleccionadas);
    if (nuevas.has(idx)) {
      nuevas.delete(idx);
      setSeleccionadas(nuevas);
      return;
    }
    nuevas.add(idx);
    setSeleccionadas(nuevas);
    // clic remoto al centro de la tile
    send({ type: "clic-tile", nx: (col + 0.5) / estado.filas, ny: (row + 0.5) / estado.filas });
  };

  return (
    <div className="rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] p-6 mb-6">
      <h2 className="text-[16px] font-semibold text-[var(--fg)] mb-4">Verificación de seguridad</h2>

      {/* checkbox clon */}
      {(estado.fase === "listo" || estado.fase === "resuelto") && (
        <div
          onClick={estado.fase === "listo" ? clicCheckbox : undefined}
          className={`inline-flex items-center gap-3 border border-[var(--separator)] bg-[var(--surface2)] rounded px-3 py-3 w-full max-w-[302px] ${
            estado.fase === "listo" ? "cursor-pointer hover:border-[#007aff]" : ""
          }`}
        >
          <span
            className={`w-7 h-7 rounded border-2 grid place-items-center text-[18px] ${
              estado.fase === "resuelto" ? "border-[#34c759] text-[#34c759]" : "border-[#c1c1c1]"
            }`}
          >
            {estado.fase === "resuelto" ? "✔" : ""}
          </span>
          <span className="flex-1 text-[14px] text-[var(--fg)]">
            {estado.fase === "resuelto" ? "Verificado" : "No soy un robot"}
          </span>
          <span className="text-[10px] text-[var(--secondary)] text-center leading-tight">
            <span className="block text-[20px] text-[#007aff] font-bold">↻</span>
            reCAPTCHA
          </span>
        </div>
      )}

      {/* spinner */}
      {(estado.fase === "conectando" ||
        estado.fase === "iniciando" ||
        estado.fase === "verificando") && (
        <div className="py-4">
          <div className="w-6 h-6 border-[3px] border-[var(--separator)] border-t-[#007aff] rounded-full animate-spin mx-auto" />
          <p className="text-[12px] text-[var(--secondary)] text-center mt-2">
            {estado.fase === "conectando"
              ? "Conectando con el sistema de turnos..."
              : estado.fase === "iniciando"
              ? "Abriendo navegador remoto..."
              : "Verificando... puede venir otra ronda de imágenes"}
          </p>
        </div>
      )}

      {/* desafío */}
      {estado.fase === "desafio" && (
        <div className="max-w-[302px] border border-[var(--separator)] rounded overflow-hidden">
          <div className="bg-[#2a4470] text-white text-[13px] px-3 py-2.5">{estado.texto}</div>
          <div className="relative">
            {/* data URL dinámica del challenge: next/image no aporta nada acá */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/jpeg;base64,${estado.imagen}`}
              alt="Desafío de verificación"
              className="w-full block cursor-crosshair select-none"
              onClick={clicTile}
            />            {[...seleccionadas].map((idx) => {
              const row = Math.floor(idx / estado.filas);
              const col = idx % estado.filas;
              return (
                <span
                  key={idx}
                  className="absolute border-2 border-white outline outline-2 outline-[#1a73e8] pointer-events-none bg-[#1a73e8]/10"
                  style={{
                    left: `${(col * 100) / estado.filas}%`,
                    top: `${(row * 100) / estado.filas}%`,
                    width: `${100 / estado.filas}%`,
                    height: `${100 / estado.filas}%`,
                  }}
                >
                  <span className="absolute top-0.5 right-0.5 bg-[#1a73e8] text-white text-[10px] leading-none px-1 py-0.5 rounded-sm">
                    ✔
                  </span>
                </span>
              );
            })}
          </div>
          <div className="flex items-center gap-2 px-3 py-2">
            <button type="button" onClick={recargar} title="Otro desafío" className="text-[16px] text-[var(--secondary)] hover:text-[var(--fg)]">
              ↻
            </button>
            <button
              type="button"
              onClick={verificar}
              className="ml-auto bg-[#007aff] text-white text-[13px] font-bold px-4 py-1.5 rounded active:scale-95"
            >
              VERIFICAR
            </button>
          </div>
          <p className="text-[11px] text-[var(--secondary)] px-3 pb-2.5">
            Puede haber varias rondas: seleccioná y apretá VERIFICAR hasta que la casilla se tilde sola.
          </p>
        </div>
      )}

      {/* error */}
      {estado.fase === "error" && (
        <div className="rounded-xl border border-[#ff3b30]/30 bg-[#ff3b30]/10 p-3">
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
