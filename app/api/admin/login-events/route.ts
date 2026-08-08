import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { buildUserSummaries, fetchLoginEventsInRange, resolveDateRange } from "@/lib/loginEvents";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { fromISO, toISO } = resolveDateRange(
    req.nextUrl.searchParams.get("from"),
    req.nextUrl.searchParams.get("to"),
    "day"
  );
  const q = req.nextUrl.searchParams.get("q") ?? undefined;

  const rows = await fetchLoginEventsInRange(fromISO, toISO);
  return NextResponse.json({ users: buildUserSummaries(rows, q) });
}
