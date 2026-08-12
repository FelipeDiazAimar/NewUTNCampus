"use client";

/**
 * Captura de errores del navegador: parchea console.warn/console.error,
 * escucha window "error"/"unhandledrejection", y expone reportClientError
 * para que la usen los error boundaries de React (app/error.tsx,
 * app/global-error.tsx). Todo es best-effort: nunca debe romper la app.
 */

type Severity = "critical" | "error" | "warning";

interface ConsoleEntry {
  level: string;
  args: string;
  at: string;
}

const CONSOLE_BUFFER_SIZE = 30;
const DEDUPE_WINDOW_MS = 30_000;
const MAX_REPORTS_PER_SESSION = 50;

// Ruido inyectado por extensiones del navegador (traductores, gestores de
// contraseñas, adblockers, polyfills de WebExtensions) que no tiene nada que
// ver con nuestro código pero llega a window "error" / console.error igual.
// Sin este filtro, contamina el dashboard de errores y tapa los reales.
const IGNORED_MESSAGE_PATTERNS = [
  /runtime\.sendMessage/i,
  /extension context invalidated/i,
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /safari-extension:\/\//i,
  /^resizeobserver loop/i,
  /^script error\.?$/i, // error sin detalle por CORS en script de terceros
];

function isIgnoredNoise(message: string, filename?: string | null): boolean {
  if (filename && /^(chrome|moz|safari)-extension:\/\//i.test(filename)) return true;
  return IGNORED_MESSAGE_PATTERNS.some((re) => re.test(message));
}

const consoleBuffer: ConsoleEntry[] = [];
const lastSentAt = new Map<string, number>();
let reportCount = 0;
let initialized = false;

function stringifyArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? a.message;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function pushConsoleEntry(level: string, text: string) {
  consoleBuffer.push({ level, args: text, at: new Date().toISOString() });
  if (consoleBuffer.length > CONSOLE_BUFFER_SIZE) consoleBuffer.shift();
}

function shouldSend(key: string): boolean {
  if (reportCount >= MAX_REPORTS_PER_SESSION) return false;
  const now = Date.now();
  const last = lastSentAt.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  lastSentAt.set(key, now);
  reportCount += 1;
  return true;
}

function sendReport(payload: {
  severity: Severity;
  message: string;
  stack?: string | null;
  consoleLog?: ConsoleEntry[];
}) {
  try {
    if (isIgnoredNoise(payload.message)) return;

    const section = window.location.pathname;
    const key = `${payload.severity}:${payload.message}:${section}`;
    if (!shouldSend(key)) return;

    const body = JSON.stringify({
      severity: payload.severity,
      message: payload.message,
      stack: payload.stack ?? null,
      section,
      consoleLog: payload.consoleLog ?? [...consoleBuffer],
    });

    fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* nunca debe romper la app */
  }
}

/** Inicializa la captura global. Idempotente — instrumentation-client.ts la llama una vez. */
export function initClientErrorTracking(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    const message = stringifyArgs(args);
    sendReport({ severity: "warning", message, consoleLog: [...consoleBuffer] });
    pushConsoleEntry("warn", message);
  };

  console.error = (...args: unknown[]) => {
    originalError(...args);
    const message = stringifyArgs(args);
    sendReport({ severity: "error", message, consoleLog: [...consoleBuffer] });
    pushConsoleEntry("error", message);
  };

  window.addEventListener("error", (event) => {
    if (isIgnoredNoise(event.message || "", event.filename)) return;
    sendReport({
      severity: "error",
      message: event.message || "Error desconocido",
      stack: event.error?.stack ?? null,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    sendReport({
      severity: "error",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? (reason.stack ?? null) : null,
    });
  });
}

/** Usado por app/error.tsx y app/global-error.tsx cuando un error boundary atrapa una excepción. */
export function reportClientError(
  severity: Severity,
  message: string,
  extra?: { stack?: string | null }
): void {
  sendReport({ severity, message, stack: extra?.stack ?? null });
}
