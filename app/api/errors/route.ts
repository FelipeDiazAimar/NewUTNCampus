import { NextRequest, NextResponse } from "next/server";
import { logErrorEvent, type ConsoleEntry, type Severity } from "@/lib/errorEvents";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 4000;
const MAX_CONSOLE_ENTRIES = 30;
const VALID_SEVERITIES: Severity[] = ["critical", "error", "warning"];

function truncate(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

function sanitizeConsoleLog(value: unknown): ConsoleEntry[] | null {
  if (!Array.isArray(value)) return null;
  return value.slice(0, MAX_CONSOLE_ENTRIES).map((entry) => ({
    level: typeof entry?.level === "string" ? entry.level.slice(0, 20) : "log",
    args: truncate(entry?.args, MAX_TEXT_LENGTH) ?? "",
    at: typeof entry?.at === "string" ? entry.at : new Date().toISOString(),
  }));
}

/** Ingesta pública de errores de cliente. Nunca debe lanzar (evita reportar-se a sí mismo). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const severity = VALID_SEVERITIES.includes(body?.severity) ? (body.severity as Severity) : null;
    const message = truncate(body?.message, MAX_TEXT_LENGTH);
    if (!severity || !message) {
      return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
    }

    await logErrorEvent({
      severity,
      source: "client",
      message,
      stack: truncate(body?.stack, MAX_TEXT_LENGTH),
      section: truncate(body?.section, 500),
      consoleLog: sanitizeConsoleLog(body?.consoleLog),
      userAgent: truncate(req.headers.get("user-agent"), 500),
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
