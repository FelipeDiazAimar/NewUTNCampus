/**
 * Bloqueo de acciones de escritura sin conexión — mismo patrón que
 * lib/guest.ts (isGuestMode/triggerGuestBlock), aplicado a los mismos ~15
 * call sites ya gateados para modo invitado, porque son exactamente las
 * mismas acciones (escrituras que necesitan red real).
 */

export function isOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false;
}

/** Dispara el popup de "esta acción necesita conexión a internet". */
export function triggerOfflineBlock(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("campus:offlineblock"));
  }
}
