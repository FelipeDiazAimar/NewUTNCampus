import { NextResponse } from "next/server";
import { sessionCookieOptions } from "@/lib/cookies";
import {
  GUEST_TOKEN,
  GUEST_SESSKEY,
  GUEST_MOODLE_USER,
  GUEST_SYSACAD_USER,
  GUEST_SYSACAD_AUTH,
} from "@/lib/guest";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(new URL("/dashboard", origin));

  const keep = true; // guest session persists 30 days

  // Readable by JS (not httpOnly) — used by client-side UI gating
  res.cookies.set("campus_guest",    "1",               sessionCookieOptions(keep, false));
  res.cookies.set("moodle_user",     GUEST_MOODLE_USER, sessionCookieOptions(keep, false));
  res.cookies.set("sysacadws_user",  GUEST_SYSACAD_USER, sessionCookieOptions(keep, false));

  // HttpOnly — only the server sees these; used by API proxy routes
  res.cookies.set("moodle_session_token", GUEST_TOKEN,        sessionCookieOptions(keep, true));
  res.cookies.set("moodle_sesskey",       GUEST_SESSKEY,      sessionCookieOptions(keep, true));
  res.cookies.set("sysacadws_auth",       GUEST_SYSACAD_AUTH, sessionCookieOptions(keep, true));

  return res;
}
