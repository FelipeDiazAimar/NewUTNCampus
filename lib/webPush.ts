import webpush from "web-push";
import { supabaseFetch } from "@/lib/supabase";

type PushRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type SendPushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
};

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@localhost";

  if (!publicKey || !privateKey) {
    throw new Error("Faltan NEXT_PUBLIC_VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

async function deactivateSubscription(endpoint: string) {
  await supabaseFetch(`web_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "PATCH",
    body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
  });
}

/** Envía un payload a una lista concreta de suscripciones y limpia las caducadas. */
async function sendToRows(rows: PushRow[], payload: SendPushPayload) {
  const message = JSON.stringify({
    title: payload.title ?? "Campus UTN",
    body: payload.body ?? "Tenés una novedad.",
    url: payload.url ?? "/",
    tag: payload.tag ?? "campus-notif",
    icon: payload.icon ?? "/LOGOUTNB.png",
    badge: payload.badge ?? "/LOGOUTNB.png",
  });

  const results = await Promise.allSettled(
    rows.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        message
      )
    )
  );

  // Desactiva suscripciones que ya no existen (410 Gone / 404 Not Found).
  await Promise.all(
    results.map((result, index) => {
      if (result.status === "rejected") {
        const statusCode = (result.reason as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          return deactivateSubscription(rows[index].endpoint);
        }
      }
      return Promise.resolve();
    })
  );

  return {
    total: rows.length,
    sent: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
  };
}

/** Envía a TODAS las suscripciones activas (broadcast — p.ej. alertas de asistencia). */
export async function sendPushNotification(payload: SendPushPayload) {
  configureWebPush();

  const res = await supabaseFetch(
    "web_push_subscriptions?active=eq.true&select=endpoint,p256dh,auth"
  );
  if (!res.ok) throw new Error(await res.text());

  const rows = (await res.json()) as PushRow[];
  return sendToRows(rows, payload);
}

/** Envía solo a las suscripciones de un usuario específico (por user_key). */
export async function sendPushToUser(userKey: string, payload: SendPushPayload) {
  configureWebPush();

  const res = await supabaseFetch(
    `web_push_subscriptions?active=eq.true&user_key=eq.${encodeURIComponent(userKey)}&select=endpoint,p256dh,auth`
  );
  if (!res.ok) throw new Error(await res.text());

  const rows = (await res.json()) as PushRow[];
  return sendToRows(rows, payload);
}
