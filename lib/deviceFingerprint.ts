// Huella del dispositivo usada por el sistema de asistencias legacy
// (anti-fraude server-side, ver ASISTENCIA_LEGACY.md).
// Vive en localStorage como fuente de verdad y se espeja en una cookie
// legible por las rutas de API.

export function newDeviceFingerprintId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `d${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export function writeDeviceFingerprint(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("deviceFingerprint", id);
  document.cookie = `deviceFingerprint=${id}; path=/`;
}

/**
 * Rehace la huella: nueva id en localStorage + cookie regenerada.
 * Se usa en cada inicio de sesión para que la cookie no sobreviva entre usuarios.
 */
export function rotateDeviceFingerprint(): void {
  if (typeof window === "undefined") return;
  writeDeviceFingerprint(newDeviceFingerprintId());
}

export function ensureDeviceFingerprint(): void {
  if (typeof window === "undefined") return;
  const id = localStorage.getItem("deviceFingerprint") ?? newDeviceFingerprintId();
  writeDeviceFingerprint(id);
}
