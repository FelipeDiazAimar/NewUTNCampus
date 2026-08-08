import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import {
  argentinaTodayRangeISO,
  buildSeries,
  countDistinctUsers,
  fetchLoginEventsInRange,
  resolveDateRange,
  type Granularity,
} from "@/lib/loginEvents";

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
    fetchLoginEventsInRange(fromISO, toISO),
    fetchLoginEventsInRange(today.fromISO, today.toISO),
  ]);

  return NextResponse.json({
    series: buildSeries(rangeRows, granularity, fromISO, toISO),
    todayDistinctUsers: countDistinctUsers(todayRows),
  });
}
