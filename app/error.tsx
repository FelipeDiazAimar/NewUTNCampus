"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/clientErrorReporter";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    reportClientError("critical", error.message, { stack: error.stack ?? null });
  }, [error]);

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
    </div>
  );
}
