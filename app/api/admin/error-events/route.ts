import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { fetchErrorEventsInRange, resolveDateRange, type Severity } from "@/lib/errorEvents";

export const runtime = "nodejs";

const VALID_SEVERITIES: Severity[] = ["critical", "error", "warning"];

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { fromISO, toISO } = resolveDateRange(
    req.nextUrl.searchParams.get("from"),
    req.nextUrl.searchParams.get("to"),
    "day"
  );
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() || null;
  const severityParam = req.nextUrl.searchParams.get("severity");
  const severity = VALID_SEVERITIES.includes(severityParam as Severity) ? (severityParam as Severity) : null;

  let rows = await fetchErrorEventsInRange(fromISO, toISO);
  if (severity) rows = rows.filter((r) => r.severity === severity);
  if (q) {
    rows = rows.filter(
      (r) => r.message.toLowerCase().includes(q) || (r.section ?? "").toLowerCase().includes(q)
    );
  }

  return NextResponse.json({
    events: rows.map((r) => ({
      id: r.id,
      severity: r.severity,
      source: r.source,
      message: r.message,
      stack: r.stack,
      section: r.section,
      consoleLog: r.console_log,
      requestInfo: r.request_info,
      userAgent: r.user_agent,
      createdAt: r.created_at,
    })),
  });
}
