import { initClientErrorTracking, reportClientError } from "@/lib/clientErrorReporter";

initClientErrorTracking();

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .catch((err) => {
      reportClientError("warning", `Registro del Service Worker falló: ${(err as Error).message}`);
    });

  // El SW no tiene acceso directo a reportClientError (hilo aparte) — reenvía
  // acá los fallos de cacheo que reporta vía postMessage (ver public/sw.js).
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "campus:sw-cache-error") return;
    reportClientError("warning", `offline-cache (SW): ${event.data.context} — ${event.data.message ?? "error desconocido"}`);
  });
}
