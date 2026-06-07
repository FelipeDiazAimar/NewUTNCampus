/**
 * Opciones de cookie compartidas por las sesiones de Campus (Moodle) y Sysacad.
 *
 * - remember = true  → cookie PERSISTENTE: sobrevive al cierre del navegador
 *   durante 30 días, así el usuario no vuelve a tipear la contraseña.
 * - remember = false → cookie de SESIÓN (sin maxAge): vive mientras el navegador
 *   siga abierto y se renueva con la actividad. No hay cierre de sesión por tiempo.
 */
export const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge?: number;
}

export function sessionCookieOptions(remember: boolean, httpOnly: boolean): CookieOptions {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Sin maxAge ⇒ cookie de sesión (se borra al cerrar el navegador).
    ...(remember ? { maxAge: REMEMBER_MAX_AGE } : {}),
  };
}
