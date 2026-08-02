import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, ADMIN_UI_COOKIE, createAdminSession } from "@/lib/adminAuth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;
  if (!adminUser || !adminPass) {
    return NextResponse.json({ error: "Panel admin no configurado" }, { status: 500 });
  }

  if (body.username !== adminUser || body.password !== adminPass) {
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  const cookieOpts = {
    sameSite: "strict" as const,
    path: "/",
    maxAge: 60 * 60 * 24, // 24 horas
    secure: process.env.NODE_ENV === "production",
  };
  res.cookies.set(ADMIN_SESSION_COOKIE, createAdminSession(), { ...cookieOpts, httpOnly: true });
  res.cookies.set(ADMIN_UI_COOKIE, "1", { ...cookieOpts, httpOnly: false });
  return res;
}
