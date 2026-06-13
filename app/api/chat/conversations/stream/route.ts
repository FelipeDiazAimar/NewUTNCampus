import { NextRequest } from "next/server";
import { callMoodleService } from "@/lib/moodle";
import { mapConversation, type GetConversationsData } from "@/lib/chat";
import { isGuestRequest } from "@/lib/guest";
import { MOCK_CONVERSATIONS } from "@/lib/guestMockData";

export const runtime = "nodejs";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

const TOTAL_CAP = 50; // tope total de conversaciones a traer
const MAX_PAGE = 16; // tamaño máximo de página al rampar

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
 * GET /api/chat/conversations/stream  (Server-Sent Events)
 *
 * Emite las conversaciones de a una, apenas están disponibles, en orden de
 * recencia (sin re-ordenar). Pagina `core_message_get_conversations` con tamaño
 * creciente (1, 2, 4, 8, 16…): la primera conversación aparece casi al instante
 * y el resto va llegando, manteniendo bajo el número total de llamadas a Moodle.
 *
 * Eventos: { type: "conv", conv } por cada conversación; { type: "done", meId }
 * al terminar; { type: "error", message } ante un fallo.
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const frame = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

  // ── Modo invitado: datos mock, emitidos de a uno ──────────────────────────
  if (isGuestRequest(req)) {
    const GUEST_ID = 9999;
    const convs = MOCK_CONVERSATIONS.map((c) => mapConversation(c, GUEST_ID)).sort(
      (a, b) => b.lastTimestamp - a.lastTimestamp
    );
    const stream = new ReadableStream({
      async start(controller) {
        for (const conv of convs) {
          controller.enqueue(frame({ type: "conv", conv }));
          await new Promise((r) => setTimeout(r, 80)); // simula llegada progresiva
        }
        controller.enqueue(frame({ type: "done", meId: GUEST_ID }));
        controller.close();
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  const auth = getAuth(req);
  if (!auth || !auth.userid) {
    return new Response(frame({ type: "error", status: 401, message: "No autenticado" }), {
      status: 401,
      headers: SSE_HEADERS,
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let from = 0;
        let size = 1;
        while (from < TOTAL_CAP) {
          const limitnum = Math.min(size, TOTAL_CAP - from);
          const data = (await callMoodleService(auth.cookie, auth.sesskey, "core_message_get_conversations", {
            userid: auth.userid,
            type: null,
            limitnum,
            limitfrom: from,
            favourites: null,
            mergeself: true,
          })) as unknown as GetConversationsData;

          const list = data.conversations ?? [];
          for (const raw of list) {
            controller.enqueue(frame({ type: "conv", conv: mapConversation(raw, auth.userid) }));
          }

          if (list.length < limitnum) break; // no hay más conversaciones
          from += list.length;
          size = Math.min(size * 2, MAX_PAGE);
        }
        controller.enqueue(frame({ type: "done", meId: auth.userid }));
      } catch (err) {
        controller.enqueue(frame({ type: "error", message: (err as Error).message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
