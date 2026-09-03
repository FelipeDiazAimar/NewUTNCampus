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
  paso?: string;
  detalle?: unknown;
  t?: number;
};

type Diag = { paso: string; detalle?: unknown; t: number };

// NEXT_PUBLIC_CAPTCHA_WS_URL puede ser UNA url o VARIAS separadas por coma (una
// por PC worker). Devuelve la lista de candidatos ya barajada y con el token.
function wsUrls(): string[] {
  const custom = process.env.NEXT_PUBLIC_CAPTCHA_WS_URL?.trim();
  const token = process.env.NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN;
  if (!custom) {
    return [`${location.protocol === "https:" ? "wss://" : "ws://"}${location.host}/api/captcha`];
  }
  const lista = custom.split(",").map((s) => s.trim()).filter(Boolean);
  // Fisher-Yates: reparte carga entre workers.
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista.map((u) =>
    token ? u + (u.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token) : u
  );
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
  const [diags, setDiags] = useState<Diag[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  // Ronda actual: texto de la consigna + data-URL por celda. Sirve para
  // resetear la selección cuando cambia el desafío (y solo conservarla en las
  // celdas cuya imagen no cambió dentro de la misma ronda).
  const rondaRef = useRef<{ texto: string; firmas: string[] }>({ texto: "", firmas: [] });

  useEffect(() => {
    const urls = wsUrls();
    let cancelado = false;
    let idx = 0;
    let arranco = false; // ya recibimos algo del server => no hacer failover

    const onMensaje = (ev: MessageEvent) => {
      arranco = true;
      const m: MensajeServidor = JSON.parse(ev.data);
      if (m.type === "diag") {
        setDiags((d) => [...d, { paso: m.paso || "?", detalle: m.detalle, t: m.t || Date.now() }].slice(-60));
        return;
      }
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
          const imgs = m.imgs ?? [];
          const texto = m.texto || "";
          // Firma por celda = su data-URL (o marcador si es null/consumida).
          const firmaDe = (c: CeldaDom) => (c ? imgs[c.i] ?? "" : "·null·");
          const prev = rondaRef.current;
          // Misma ronda solo si la consigna y la cantidad de celdas coinciden.
          const mismaRonda = prev.texto === texto && prev.firmas.length === celdas.length;
          setSeleccionadas((old) => {
            if (!mismaRonda) return new Set();
            const next = new Set<number>();
            celdas.forEach((c, idx) => {
              if (c && old.has(idx) && prev.firmas[idx] === firmaDe(c)) next.add(idx);
            });
            return next;
          });
          rondaRef.current = { texto, firmas: celdas.map(firmaDe) };
          setEstado({ fase: "desafio", texto, filas: m.filas || 3, imgs, celdas });
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

    const conectar = () => {
      if (cancelado) return;
      const ws = new WebSocket(urls[idx]);
      wsRef.current = ws;
      arranco = false;
      ws.onopen = () => ws.send(JSON.stringify({ type: "iniciar" }));
      ws.onmessage = onMensaje;
      ws.onerror = () => {};
      ws.onclose = () => {
        if (cancelado) return;
        if (arranco) {
          setEstado((prev) =>
            prev.fase === "resuelto" || prev.fase === "error"
              ? prev
              : { fase: "error", mensaje: "Se cortó la conexión con el servicio de captcha." }
          );
          return;
        }
        // Este worker no respondió: probar el siguiente.
        idx++;
        if (idx < urls.length) conectar();
        else
          setEstado({
            fase: "error",
            mensaje: "No se pudo conectar con el servicio de captcha. Probá de nuevo en un momento.",
          });
      };
    };
    conectar();

    return () => {
      cancelado = true;
      try {
        wsRef.current?.send(JSON.stringify({ type: "abortar" }));
      } catch {
        /* ya cerrado */
      }
      wsRef.current?.close();
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

      {/* ── Panel de diagnóstico (traza paso a paso del server) ──────────── */}
      {diags.length > 0 && (
        <details className="mt-3 w-full max-w-[304px] text-left" open={estado.fase === "error"}>
          <summary className="text-[11px] text-[var(--secondary)] cursor-pointer select-none">
            Diagnóstico · {diags.length} pasos
          </summary>
          <div className="mt-1 max-h-48 overflow-auto rounded-lg bg-[#111] text-[#d0d0d0] text-[10px] font-mono leading-tight p-2 space-y-0.5">
            {diags.map((d, i) => (
              <div key={i} className={d.paso.includes("ERROR") || d.paso.includes("EXCEPCION") || d.paso.includes("TIMEOUT") || d.paso.includes("SIN-") ? "text-[#ff6b6b]" : ""}>
                <span className="text-[#666]">
                  {new Date(d.t).toLocaleTimeString("es-AR", { hour12: false })}
                </span>{" "}
                <span className="text-[#6cf]">{d.paso}</span>
                {d.detalle !== undefined && d.detalle !== "" && (
                  <span className="text-[#bbb]">
                    {" "}
                    {typeof d.detalle === "string" ? d.detalle : JSON.stringify(d.detalle)}
                  </span>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(
                diags
                  .map(
                    (d) =>
                      `${new Date(d.t).toISOString()} ${d.paso} ${
                        d.detalle === undefined ? "" : typeof d.detalle === "string" ? d.detalle : JSON.stringify(d.detalle)
                      }`
                  )
                  .join("\n")
              );
            }}
            className="mt-1 text-[10px] text-[var(--secondary)] underline hover:text-[var(--fg)]"
          >
            Copiar traza
          </button>
        </details>
      )}
    </div>
  );
}
