/**
 * Modo invitado — utilidades compartidas entre servidor y cliente.
 *
 * Cookies que activa el modo invitado:
 *  campus_guest=1          (legible por el cliente, no httpOnly)
 *  moodle_user=...         (JSON con userid 9999 / fullname "Invitado")
 *  moodle_session_token    (httpOnly, valor centinela)
 *  moodle_sesskey          (httpOnly, valor centinela)
 *  sysacadws_user=...      (JSON con legajo/especialidad del alumno ficticio)
 *  sysacadws_auth=...      (httpOnly, Basic "guest:guest")
 */

import type { NextRequest } from "next/server";

// ─── Constantes ───────────────────────────────────────────────────────────────

export const GUEST_TOKEN   = "CAMPUS_GUEST_SESSION_TOKEN";
export const GUEST_SESSKEY = "CAMPUS_GUEST_SESSKEY";
export const GUEST_LEGAJO  = "12345";
export const GUEST_USER_ID = 9999;
export const GUEST_ID_ESPECIALIDAD = "2";
export const GUEST_PLAN    = "2008";

export const GUEST_MOODLE_USER = JSON.stringify({
  userid:   GUEST_USER_ID,
  fullname: "Invitado",
  username: "invitado",
});

export const GUEST_SYSACAD_USER = JSON.stringify({
  legajo:         GUEST_LEGAJO,
  nombre:         "Invitado",
  especialidad:   "Ingeniería en Sistemas de Información",
  estado:         "Activo",
  idEspecialidad: GUEST_ID_ESPECIALIDAD,
  plan:           GUEST_PLAN,
});

// base64("guest:guest")
export const GUEST_SYSACAD_AUTH = "Z3Vlc3Q6Z3Vlc3Q=";

// ─── Server-side ──────────────────────────────────────────────────────────────

export function isGuestRequest(req: NextRequest): boolean {
  return req.cookies.get("campus_guest")?.value === "1";
}

// ─── Client-side ─────────────────────────────────────────────────────────────

export function isGuestMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim() === "campus_guest=1");
}

/** Dispara el popup de "acción no disponible en modo invitado". */
export function triggerGuestBlock(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("campus:guestblock"));
  }
}
