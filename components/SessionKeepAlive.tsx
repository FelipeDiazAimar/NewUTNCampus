"use client";

import { useEffect } from "react";

// Cada cuánto pingueamos a Moodle para renovar la sesión mientras la pestaña
// esté abierta. Por debajo del timeout de inactividad del servidor.
const INTERVAL = 4 * 60 * 1000; // 4 min

/**
 * Mantiene viva la sesión del Campus mientras el navegador esté abierto: llama a
 * GET /api/auth periódicamente (y al volver a la pestaña) para rotar el token de
 * Moodle y deslizar la expiración de las cookies. No renderiza nada.
 *
 * Sysacad no lo necesita: su credencial Basic (legajo:DNI) no expira.
 */
export default function SessionKeepAlive() {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      if (!document.cookie.includes("moodle_user")) return;
      fetch("/api/auth", { method: "GET" }).catch(() => {});
    };

    const timer = setInterval(ping, INTERVAL);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
