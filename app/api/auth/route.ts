import { NextRequest, NextResponse } from "next/server";
import { moodleLogin } from "@/lib/moodle";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Campos requeridos" }, { status: 400 });
  }

  console.log("[auth] Login attempt for user:", username);
  try {
    const session = await moodleLogin(username, password);
    console.log("[auth] Login successful:", { userid: session.userid, fullname: session.fullname });
    const response = NextResponse.json({ ok: true, session });
    // Store only the token value, not the full "MoodleSession=TOKEN" string
    const sessionToken = session.cookie.replace("MoodleSession=", "");
    response.cookies.set("moodle_session_token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 8,
    });
    response.cookies.set("moodle_sesskey", session.sesskey, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 8,
    });
    response.cookies.set(
      "moodle_user",
      JSON.stringify({
        userid: session.userid,
        fullname: session.fullname,
        username: session.username,
      }),
      {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 8,
      }
    );
    return response;
  } catch (err) {
    console.error("[auth] Login error:", (err as Error).message);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 401 }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("moodle_session_token");
  response.cookies.delete("moodle_sesskey");
  response.cookies.delete("moodle_user");
  return response;
}
