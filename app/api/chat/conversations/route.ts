import { NextRequest, NextResponse } from "next/server";
import { callMoodleService } from "@/lib/moodle";
import { mapConversation, type GetConversationsData } from "@/lib/chat";
import { isGuestRequest } from "@/lib/guest";
import { MOCK_CONVERSATIONS } from "@/lib/guestMockData";

export const runtime = "nodejs";

/** Lee la sesión de Moodle (cookie httpOnly) + el userid legible. */
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
 * GET /api/chat/conversations
 * Intercepta core_message_get_conversations y devuelve `Conversation[]` limpio,
 * sin el envoltorio [{error,data}] ni el HTML de los mensajes.
 */
export async function GET(req: NextRequest) {
  if (isGuestRequest(req)) {
    const GUEST_ID = 9999;
    const conversations = MOCK_CONVERSATIONS
      .map((c) => mapConversation(c, GUEST_ID))
      .sort((a, b) => {
        const ua = a.unread > 0 ? 1 : 0;
        const ub = b.unread > 0 ? 1 : 0;
        if (ua !== ub) return ub - ua;
        return b.lastTimestamp - a.lastTimestamp;
      });
    return NextResponse.json({ conversations, meId: GUEST_ID });
  }

  const auth = getAuth(req);
  if (!auth || !auth.userid) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const data = (await callMoodleService(auth.cookie, auth.sesskey, "core_message_get_conversations", {
      userid: auth.userid,
      type: null,
      limitnum: 50,
      limitfrom: 0,
      favourites: null, // null = todas (favoritas y no favoritas)
      mergeself: true,
    })) as unknown as GetConversationsData;

    // Orden: primero los no leídos, y dentro de cada grupo, el más reciente arriba.
    const conversations = (data.conversations ?? [])
      .map((c) => mapConversation(c, auth.userid))
      .sort((a, b) => {
        const ua = a.unread > 0 ? 1 : 0;
        const ub = b.unread > 0 ? 1 : 0;
        if (ua !== ub) return ub - ua;
        return b.lastTimestamp - a.lastTimestamp;
      });

    return NextResponse.json({ conversations, meId: auth.userid });
  } catch (err) {
    console.error("[chat/conversations]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
