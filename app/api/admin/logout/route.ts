import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, ADMIN_UI_COOKIE } from "@/lib/adminAuth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  res.cookies.set(ADMIN_UI_COOKIE, "", { httpOnly: false, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
