import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("admin_session_token", "", {
    httpOnly: false,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
