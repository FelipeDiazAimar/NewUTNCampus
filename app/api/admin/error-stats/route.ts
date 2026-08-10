import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import {
  argentinaTodayRangeISO,
  buildSeverityStats,
  buildSeveritySeries,
  fetchErrorEventsInRange,
  resolveDateRange,
  type Granularity,
} from "@/lib/errorEvents";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const granularity: Granularity = req.nextUrl.searchParams.get("granularity") === "month" ? "month" : "day";
  const { fromISO, toISO } = resolveDateRange(
    req.nextUrl.searchParams.get("from"),
    req.nextUrl.searchParams.get("to"),
    granularity
  );

  const today = argentinaTodayRangeISO();
  const [rangeRows, todayRows] = await Promise.all([
    fetchErrorEventsInRange(fromISO, toISO),
    fetchErrorEventsInRange(today.fromISO, today.toISO),
  ]);

  return NextResponse.json({
    series: buildSeveritySeries(rangeRows, granularity, fromISO, toISO),
    todayCounts: buildSeverityStats(todayRows),
  });
}
