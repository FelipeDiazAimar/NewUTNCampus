import { NextRequest, NextResponse } from "next/server";
import { callMoodleService } from "@/lib/moodle";

export const runtime = "nodejs";

function getAuth(req: NextRequest): { cookie: string; sesskey: string; userid: number } | null {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  if (!sessionToken) return null;
  const sesskey = req.cookies.get("moodle_sesskey")?.value ?? "";
  let userid = 0;
  try {
    userid = Number(JSON.parse(req.cookies.get("moodle_user")?.value ?? "{}").userid) || 0;
  } catch { /* ignore */ }
  return { cookie: `MoodleSession=${sessionToken}`, sesskey, userid };
}

/** POST /api/chat/read { convid } → marca la conversación como leída. */
export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth || !auth.userid) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { convid } = await req.json().catch(() => ({}));
  if (!convid) {
    return NextResponse.json({ error: "convid requerido" }, { status: 400 });
  }

  try {
    await callMoodleService(auth.cookie, auth.sesskey, "core_message_mark_all_conversation_messages_as_read", {
      userid: auth.userid,
      conversationid: Number(convid),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[chat/read]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
