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
};

export type SendPushResult = {
  total: number;
  sent: number;
  failed: number;
  errors?: { endpoint: string; status: number; message: string }[];
};

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";

  // Apple APNs rechaza subjects con "localhost". Usar la URL de la app o un mailto real.
  const subject =
    process.env.VAPID_SUBJECT ??
    (process.env.NEXT_PUBLIC_APP_URL
      ? process.env.NEXT_PUBLIC_APP_URL
      : "mailto:admin@campusutn.dpdns.org");

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
async function sendToRows(rows: PushRow[], payload: SendPushPayload): Promise<SendPushResult> {
  // badge no está soportado en iOS — quitarlo del payload evita rechazos de APNs.
  const message = JSON.stringify({
    title: payload.title ?? "Campus UTN",
    body: payload.body ?? "Tenés una novedad.",
    url: payload.url ?? "/",
    tag: payload.tag ?? "campus-notif",
    icon: payload.icon ?? "/logo.png",
  });

  const results = await Promise.allSettled(
    rows.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        message
      )
    )
  );

  const errors: SendPushResult["errors"] = [];

  await Promise.all(
    results.map((result, index) => {
      if (result.status === "rejected") {
        const err = result.reason as { statusCode?: number; body?: string; message?: string };
        const status = err.statusCode ?? 0;
        const msg = err.body ?? err.message ?? String(result.reason);
        const short = rows[index].endpoint.slice(-20);

        console.error(`[webPush] failed (${status}) ...${short}: ${msg}`);
        errors.push({ endpoint: short, status, message: msg });

        if (status === 404 || status === 410) {
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
    ...(errors.length > 0 && { errors }),
  };
}

/** Envía a TODAS las suscripciones activas (broadcast — p.ej. alertas de asistencia). */
export async function sendPushNotification(payload: SendPushPayload): Promise<SendPushResult> {
  configureWebPush();

  const res = await supabaseFetch(
    "web_push_subscriptions?active=eq.true&select=endpoint,p256dh,auth"
  );
  if (!res.ok) throw new Error(await res.text());

  const rows = (await res.json()) as PushRow[];
  return sendToRows(rows, payload);
}

/** Envía solo a las suscripciones de un usuario específico (por user_key). */
export async function sendPushToUser(userKey: string, payload: SendPushPayload): Promise<SendPushResult> {
  configureWebPush();

  const res = await supabaseFetch(
    `web_push_subscriptions?active=eq.true&user_key=eq.${encodeURIComponent(userKey)}&select=endpoint,p256dh,auth`
  );
  if (!res.ok) throw new Error(await res.text());

  const rows = (await res.json()) as PushRow[];
  return sendToRows(rows, payload);
}
