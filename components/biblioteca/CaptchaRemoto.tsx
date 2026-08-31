"use client";

// Espejo del captcha remoto: se conecta por WS a la sesión headless, replica el
// checkbox y el desafío de imágenes, y devuelve el token al resolverlo.
//
// Modo DOM (Fase 2): el server serializa la grilla real celda por celda
// (celdas: string[] de data-URLs, '' = tile consumida) y re-emite al cambiar la
// firma del DOM. La selección es local-optimista; si la imagen de una celda
// cambia en el widget real, esa celda se limpia (nueva tile = deseleccionada).
// Fallback: el server puede mandar celdas.length === 1 (screenshot completo,
// modo Fase 1) y el cliente vuelve al clic por coordenadas normalizadas.

import { useEffect, useRef, useState } from "react";

type Estado =
  | { fase: "conectando" }
  | { fase: "iniciando" }
  | { fase: "listo" }
  | { fase: "verificando"; texto?: string }
  | { fase: "desafio"; texto: string; filas: number; celdas: string[] }
  | { fase: "resuelto" }
  | { fase: "error"; mensaje: string };

type MensajeServidor = {
  type: string;
  fase?: string;
  imagen?: string;
  texto?: string;
  filas?: number;
  celdas?: string[];
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
  const prevCeldas = useRef<string[]>([]);

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
          const celdas = m.celdas ?? [];
          // Merge: conservar selección solo en celdas cuya imagen no cambió
          // (imagen nueva = tile reemplazada = deseleccionada; '' = consumida).
          setSeleccionadas((prev) => {
            const nuevas = new Set<number>();
            celdas.forEach((img, idx) => {
              if (img && img === prevCeldas.current[idx] && prev.has(idx)) nuevas.add(idx);
            });
            return nuevas;
          });
          prevCeldas.current = celdas;
          setEstado({
            fase: "desafio",
            texto: m.texto || "",
            filas: m.filas || 3,
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
    setEstado((prev) =>
      prev.fase === "desafio"
        ? { fase: "verificando", texto: "Buscando otro desafío..." }
        : { fase: "verificando", texto: "Buscando otro desafío..." }
    );
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

  // Fallback (celdas.length === 1): clic por posición dentro de la imagen.
  const clicImagenCompleta = (
    e: React.MouseEvent<HTMLImageElement>,
    filas: number
  ) => {
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.min(filas - 1, Math.floor(((e.clientX - r.left) / r.width) * filas));
    const row = Math.min(filas - 1, Math.floor(((e.clientY - r.top) / r.height) * filas));
    const idx = row * filas + col;
    setSeleccionadas((prev) => {
      const nuevas = new Set(prev);
      if (nuevas.has(idx)) nuevas.delete(idx);
      else nuevas.add(idx);
      return nuevas;
    });
    send({ type: "clic-tile", nx: (col + 0.5) / filas, ny: (row + 0.5) / filas });
  };

  return (
    <div className="rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] p-6 mb-6">
      <h2 className="text-[16px] font-semibold text-[var(--fg)] mb-1">Verificación de seguridad</h2>
      {estado.fase !== "resuelto" && (
        <p className="text-[12px] text-[#ff9500] mb-4">
          Al resolver el captcha se pedirá el turno automáticamente con los datos del formulario.
        </p>
      )}

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
              : estado.texto || "Verificando... puede venir otra ronda de imágenes"}
          </p>
        </div>
      )}

      {/* desafío */}
      {estado.fase === "desafio" && (
        <div className="max-w-[302px] border border-[var(--separator)] rounded overflow-hidden">
          <div className="bg-[#2a4470] text-white text-[13px] px-3 py-2.5">{estado.texto}</div>

          {estado.celdas.length <= 1 ? (
            // Fallback screenshot: imagen completa + clic por coordenadas
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/jpeg;base64,${estado.celdas[0] ?? ""}`}
                alt="Desafío de verificación"
                className="w-full block cursor-crosshair select-none"
                onClick={(e) => clicImagenCompleta(e, estado.filas)}
              />
              {[...seleccionadas].map((idx) => {
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
          ) : (
            // Modo DOM: grilla por celdas espejadas del widget real
            <div
              className="grid w-full"
              style={{ gridTemplateColumns: `repeat(${estado.filas}, minmax(0, 1fr))` }}
            >
              {estado.celdas.map((img, idx) =>
                img ? (
                  <div
                    key={idx}
                    className="relative aspect-square cursor-crosshair select-none overflow-hidden"
                    onClick={() => clicCelda(idx, estado.filas)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt="" className="w-full h-full object-cover block" />
                    {seleccionadas.has(idx) && (
                      <span className="absolute inset-0 border-2 border-white outline outline-2 outline-[#1a73e8] bg-[#1a73e8]/10 pointer-events-none">
                        <span className="absolute top-0.5 right-0.5 bg-[#1a73e8] text-white text-[10px] leading-none px-1 py-0.5 rounded-sm">
                          ✔
                        </span>
                      </span>
                    )}
                  </div>
                ) : (
                  // Tile consumida (desafío dinámico): gris con check
                  <div
                    key={idx}
                    className="aspect-square grid place-items-center bg-[#e8eaed] text-[#34c759] text-[16px]"
                  >
                    ✔
                  </div>
                )
              )}
            </div>
          )}

          <div className="flex items-center gap-2 px-3 py-2">
            <button
              type="button"
              title="Otro desafío"
              onClick={recargar}
              className="text-[16px] text-[var(--secondary)] hover:text-[var(--fg)]"
            >
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
