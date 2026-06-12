/**
 * GET /api/chat/notify
 *
 * Invocado por Vercel Cron (vercel.json) cada minuto.
 * Para cada usuario suscrito a push, consulta Moodle con su sesión almacenada
 * y envía una notificación si el conteo de mensajes sin leer aumentó.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * MIGRACIÓN REQUERIDA EN SUPABASE (ejecutar una sola vez en el SQL Editor):
 *
 *   ALTER TABLE web_push_subscriptions
 *     ADD COLUMN IF NOT EXISTS moodle_session_token TEXT,
 *     ADD COLUMN IF NOT EXISTS moodle_sesskey       TEXT,
 *     ADD COLUMN IF NOT EXISTS moodle_userid        INTEGER,
 *     ADD COLUMN IF NOT EXISTS last_chat_unread     INTEGER DEFAULT 0;
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Seguridad:
 *   - Vercel Cron envía  Authorization: Bearer <CRON_SECRET>
 *   - Llamadas manuales pueden usar  x-notify-secret: <NOTIFICATIONS_WEBHOOK_SECRET>
 *   - Si ninguna var está definida, el endpoint está abierto (solo dev).
 */

import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { supabaseFetch } from "@/lib/supabase";
import { callMoodleService } from "@/lib/moodle";
import type { GetConversationsData, MoodleConversation } from "@/lib/chat";

export const runtime = "nodejs";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type SubRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_key: string;
  moodle_session_token: string;
  moodle_sesskey: string | null;
  moodle_userid: number;
  last_chat_unread: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function configureWebPush() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? "";
  const priv = process.env.VAPID_PRIVATE_KEY ?? "";
  // Apple APNs rechaza subjects con "localhost". Usar la URL real de la app o un mailto válido.
  const sub =
    process.env.VAPID_SUBJECT ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "mailto:admin@campusutn.dpdns.org";
  if (!pub || !priv) throw new Error("Faltan claves VAPID");
  webpush.setVapidDetails(sub, pub, priv);
}

/** Devuelve el set de user_key (email) con los avisos de chat desactivados. */
async function fetchChatDisabledUsers(): Promise<Set<string>> {
  // Avisos de chat off si el global está pausado O si notificar_chat es false.
  const res = await supabaseFetch(
    "perfil_notificaciones" +
      "?or=(notificaciones_globales_activas.eq.false,notificar_chat.eq.false)" +
      "&select=email"
  );
  if (!res.ok) return new Set();
  const rows = (await res.json()) as { email: string }[];
  return new Set(rows.map((r) => r.email));
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Cuenta mensajes no leídos y extrae datos del primer chat con mensajes nuevos. */
function analyzeConversations(
  convs: MoodleConversation[],
  myId: number
): { total: number; sender: string | null; preview: string | null } {
  let total = 0;
  let sender: string | null = null;
  let preview: string | null = null;

  for (const c of convs) {
    const n = c.unreadcount ?? (c.isread === false ? 1 : 0);
    total += n;
    if (n > 0 && sender === null) {
      sender = c.name || c.members.find((m) => m.id !== myId)?.fullname || "Alguien";
      preview = c.messages[0] ? stripHtml(c.messages[0].text).slice(0, 100) : null;
    }
  }

  return { total, sender, preview };
}

/** Actualiza last_chat_unread para todos los dispositivos de un usuario. */
async function updateLastUnread(userKey: string, count: number) {
  await supabaseFetch(
    `web_push_subscriptions?user_key=eq.${encodeURIComponent(userKey)}&active=eq.true`,
    {
      method: "PATCH",
      body: JSON.stringify({ last_chat_unread: count }),
    }
  );
}

/** Desactiva una suscripción expirada. */
async function deactivate(endpoint: string) {
  await supabaseFetch(
    `web_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
    { method: "PATCH", body: JSON.stringify({ active: false }) }
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── Autenticación ──────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET ?? "";
  const webhookSecret = process.env.NOTIFICATIONS_WEBHOOK_SECRET ?? "";

  if (cronSecret || webhookSecret) {
    const authHeader = req.headers.get("authorization") ?? "";
    const xSecret = req.headers.get("x-notify-secret") ?? "";
    const validCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
    const validWebhook = webhookSecret && xSecret === webhookSecret;
    if (!validCron && !validWebhook) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
  }

  try {
    configureWebPush();

    // ── Suscripciones activas con sesión Moodle almacenada ──────────────────
    const res = await supabaseFetch(
      "web_push_subscriptions" +
        "?active=eq.true" +
        "&moodle_session_token=not.is.null" +
        "&moodle_userid=not.is.null" +
        "&select=endpoint,p256dh,auth,user_key,moodle_session_token,moodle_sesskey,moodle_userid,last_chat_unread"
    );
    if (!res.ok) return NextResponse.json({ error: "Supabase error" }, { status: 500 });

    const subs = (await res.json()) as SubRow[];
    if (subs.length === 0) return NextResponse.json({ ok: true, checked: 0 });

    // ── Usuarios que desactivaron los avisos de chat (o el global) ──────────
    const disabled = await fetchChatDisabledUsers();

    // ── Agrupar por user_key (un usuario puede tener varios dispositivos) ────
    const byUser = new Map<string, SubRow[]>();
    for (const s of subs) {
      if (disabled.has(s.user_key)) continue; // respeta el toggle de Chats
      if (!byUser.has(s.user_key)) byUser.set(s.user_key, []);
      byUser.get(s.user_key)!.push(s);
    }

    let checked = 0;
    let notified = 0;

    await Promise.allSettled(
      [...byUser.entries()].map(async ([userKey, devices]) => {
        // Usamos la sesión del primer dispositivo para consultar Moodle.
        const primary = devices[0];
        const cookie = `MoodleSession=${primary.moodle_session_token}`;
        const sesskey = primary.moodle_sesskey ?? "";
        const userid = primary.moodle_userid;

        let data: GetConversationsData;
        try {
          data = (await callMoodleService(
            cookie,
            sesskey,
            "core_message_get_conversations",
            { userid, type: null, limitnum: 50, limitfrom: 0, favourites: null, mergeself: true }
          )) as unknown as GetConversationsData;
        } catch {
          // Sesión expirada u otro error de Moodle → omitir este usuario.
          return;
        }

        checked++;
        const { total, sender, preview } = analyzeConversations(
          data.conversations ?? [],
          userid
        );

        const lastUnread = primary.last_chat_unread ?? 0;

        // Si el conteo bajó o no cambió, solo actualizamos si bajó para sincronizar.
        if (total <= lastUnread) {
          if (total < lastUnread) await updateLastUnread(userKey, total);
          return;
        }

        // ── Hay mensajes nuevos → enviar push a todos los dispositivos ───────
        const newCount = total - lastUnread;
        const title =
          newCount === 1 && sender
            ? `Mensaje de ${sender}`
            : `${newCount} mensajes nuevos`;
        const body = preview ?? "Tenés mensajes nuevos en Campus UTN.";

        const message = JSON.stringify({
          title,
          body,
          url: "/chat",
          tag: "chat-message",
          icon: "/LOGOUTNB.png",
          badge: "/LOGOUTNB.png",
        });

        await Promise.allSettled(
          devices.map((d) =>
            webpush
              .sendNotification(
                { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
                message
              )
              .catch(async (err: { statusCode?: number }) => {
                if (err.statusCode === 404 || err.statusCode === 410) {
                  await deactivate(d.endpoint);
                }
              })
          )
        );

        await updateLastUnread(userKey, total);
        notified++;
      })
    );

    return NextResponse.json({ ok: true, checked, notified });
  } catch (err) {
    console.error("[chat/notify]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
