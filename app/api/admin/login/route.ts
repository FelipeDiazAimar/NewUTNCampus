import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const ADMIN_USER = "admin";
const ADMIN_PASS = "Admin123!";
// Token fijo — suficiente para un panel de dev interno hardcodeado.
const SESSION_TOKEN = "campus-admin-2024-internal";

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (body.username !== ADMIN_USER || body.password !== ADMIN_PASS) {
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("admin_session_token", SESSION_TOKEN, {
    httpOnly: false, // legible desde document.cookie para la vista de notificaciones
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 horas
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
