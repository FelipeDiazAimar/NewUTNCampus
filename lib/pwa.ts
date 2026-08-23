/** ¿Se está corriendo como PWA instalada (standalone), no en una pestaña normal del navegador? */
export function isPwaStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}
