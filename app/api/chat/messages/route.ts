import { NextRequest, NextResponse } from "next/server";
import { callMoodleService } from "@/lib/moodle";
import { mapMessage, type GetMessagesData } from "@/lib/chat";

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
 * GET /api/chat/messages?convid=N
 * Intercepta core_message_get_conversation_messages → `Message[]` (orden cronológico).
 */
export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth || !auth.userid) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const convid = Number(req.nextUrl.searchParams.get("convid"));
  if (!convid) {
    return NextResponse.json({ error: "convid requerido" }, { status: 400 });
  }

  try {
    const data = (await callMoodleService(auth.cookie, auth.sesskey, "core_message_get_conversation_messages", {
      currentuserid: auth.userid,
      convid,
      newest: false, // false = del más viejo al más nuevo
      limitnum: 100,
      limitfrom: 0,
    })) as unknown as GetMessagesData;

    const messages = (data.messages ?? []).map(mapMessage).sort((a, b) => a.timestamp - b.timestamp);
    return NextResponse.json({ messages, meId: auth.userid });
  } catch (err) {
    console.error("[chat/messages GET]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/chat/messages  { touserid, text } | { convid, text }
 * Envía un mensaje: a un usuario (instant) o a una conversación grupal.
 */
export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth || !auth.userid) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { touserid, convid, text } = await req.json().catch(() => ({}));
  if ((!touserid && !convid) || !text?.trim()) {
    return NextResponse.json({ error: "Faltan destinatario o texto." }, { status: 400 });
  }

  try {
    const result = convid
      ? await callMoodleService(auth.cookie, auth.sesskey, "core_message_send_messages_to_conversation", {
          conversationid: Number(convid),
          messages: [{ text: String(text), textformat: 2 }],
        })
      : await callMoodleService(auth.cookie, auth.sesskey, "core_message_send_instant_messages", {
          messages: [{ touserid: String(touserid), text: String(text) }],
        });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[chat/messages POST]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
