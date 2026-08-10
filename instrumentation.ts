import { type Instrumentation } from "next";
import { logErrorEvent } from "@/lib/errorEvents";

function pickUserAgent(headers: NodeJS.Dict<string | string[]>): string | null {
  const ua = headers["user-agent"];
  if (!ua) return null;
  return Array.isArray(ua) ? (ua[0] ?? null) : ua;
}

/**
 * Captura errores de servidor (API routes, render de páginas, actions) sin
 * tocar cada route handler. Solo se guarda `user-agent` de los headers de
 * request — nunca `cookie` ni `authorization`, para no filtrar tokens de
 * sesión a la tabla de errores.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const err = error as { message?: string; stack?: string; digest?: string };
  await logErrorEvent({
    severity: context.routeType === "render" ? "critical" : "error",
    source: "server",
    message: err.message ?? "Error desconocido",
    stack: err.stack ?? null,
    section: request.path,
    requestInfo: {
      method: request.method,
      routeType: context.routeType,
      routePath: context.routePath,
      digest: err.digest ?? null,
    },
    userAgent: pickUserAgent(request.headers),
  });
};
