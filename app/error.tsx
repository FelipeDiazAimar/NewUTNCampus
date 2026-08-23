"use client";

import { useEffect, useState } from "react";
import { reportClientError } from "@/lib/clientErrorReporter";

// El bloque de abajo (mensaje + stack + botón Copiar) es TEMPORAL — debug del
// guardado offline. Si el error ocurre sin conexión, reportClientError() no
// tiene forma de llegar al servidor (a diferencia del diagnóstico del
// Service Worker, este no queda guardado para reintentar) — mostrarlo acá
// deja copiarlo igual, sin depender de la red. Sacar cuando el guardado
// offline esté funcionando de forma confiable.
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    reportClientError("critical", error.message, { stack: error.stack ?? null });
  }, [error]);

  const detail = `${error.message}\n\n${error.stack ?? "(sin stack)"}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* el <textarea> de abajo sirve de respaldo para seleccionar a mano */
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-[var(--bg)]">
      <p className="text-[17px] font-semibold text-[var(--fg)]">Algo salió mal</p>
      <p className="text-[13px] text-[var(--secondary)]">Esta pantalla tuvo un error inesperado.</p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="rounded-full bg-[#007aff] px-5 py-2.5 text-[15px] font-semibold text-white active:opacity-70"
      >
        Reintentar
      </button>

      <div className="w-full max-w-md text-left mt-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
            Detalle del error
          </p>
          <button onClick={copy} className="text-[12px] font-semibold text-[#007aff] active:opacity-70">
            {copied ? "Copiado ✓" : "Copiar"}
          </button>
        </div>
        <textarea
          readOnly
          value={detail}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full h-48 rounded-xl border border-[var(--separator)] bg-[var(--surface)] p-3 text-[11px] font-mono text-[var(--fg)] resize-none"
        />
      </div>
    </div>
  );
}
