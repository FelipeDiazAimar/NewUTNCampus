import { initClientErrorTracking, reportClientError } from "@/lib/clientErrorReporter";
import { beginOfflineActivity, endOfflineActivity } from "@/lib/offlineActivity";
import { flushOfflineDiagnostics } from "@/lib/offlineDiagnostics";

initClientErrorTracking();

if (typeof window !== "undefined") {
  // Manda a /api/errors los pasos que el SW fue guardando mientras no había
  // conexión (ver lib/offlineDiagnostics.ts) — al cargar la app y cada vez
  // que vuelve la red, por si el usuario no cierra/reabre.
  flushOfflineDiagnostics();
  window.addEventListener("online", () => { flushOfflineDiagnostics(); });
}

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .catch((err) => {
      reportClientError("warning", `Registro del Service Worker falló: ${(err as Error).message}`);
    });

  // El SW no tiene acceso directo a reportClientError (hilo aparte) — reenvía
  // acá los fallos de cacheo que reporta vía postMessage (ver public/sw.js).
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "campus:sw-cache-error") {
      reportClientError("warning", `offline-cache (SW): ${event.data.context} — ${event.data.message ?? "error desconocido"}`);
      return;
    }
    if (event.data?.type === "campus:offline-activity-start") { beginOfflineActivity(); return; }
    if (event.data?.type === "campus:offline-activity-end") { endOfflineActivity(); return; }
  });
}
