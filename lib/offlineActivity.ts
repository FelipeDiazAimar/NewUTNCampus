/**
 * Contador de operaciones de guardado offline en curso (archivos vía
 * IndexedDB, páginas/datos vía el Service Worker). Usa un contador en vez de
 * un booleano simple porque pueden solaparse varias descargas a la vez — el
 * indicador visual solo debe apagarse cuando la última termina.
 */

let count = 0;

export function beginOfflineActivity(): void {
  count++;
  if (count === 1 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("campus:offline-activity", { detail: { active: true } }));
  }
}

export function endOfflineActivity(): void {
  count = Math.max(0, count - 1);
  if (count === 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("campus:offline-activity", { detail: { active: false } }));
  }
}
