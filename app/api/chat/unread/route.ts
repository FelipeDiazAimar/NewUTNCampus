import { NextRequest, NextResponse } from "next/server";
import { callMoodleService } from "@/lib/moodle";
import type { GetConversationsData } from "@/lib/chat";

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

/**
 * GET /api/chat/unread → { count, unreadMessages, unreadChats }
 * count = mensajes sin leer; si Moodle no los reporta, cae a chats sin leer.
 * Lo usa el badge rojo del logo en el Navbar.
 */
export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth || !auth.userid) {
    return NextResponse.json({ count: 0 }, { status: 401 });
  }

  try {
    const data = (await callMoodleService(auth.cookie, auth.sesskey, "core_message_get_conversations", {
      userid: auth.userid,
      type: null,
      limitnum: 50,
      limitfrom: 0,
      favourites: null,
      mergeself: true,
    })) as unknown as GetConversationsData;

    let unreadMessages = 0;
    let unreadChats = 0;
    for (const c of data.conversations ?? []) {
      const n = c.unreadcount ?? 0;
      if (n > 0 || c.isread === false) unreadChats++;
      unreadMessages += n;
    }
    const count = unreadMessages > 0 ? unreadMessages : unreadChats;
    return NextResponse.json({ count, unreadMessages, unreadChats });
  } catch (err) {
    console.error("[chat/unread]", (err as Error).message);
    return NextResponse.json({ count: 0, error: (err as Error).message }, { status: 500 });
  }
}
