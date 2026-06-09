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

async function fetchSubscriptions(): Promise<PushRow[]> {
  const res = await supabaseFetch(
    "web_push_subscriptions?active=eq.true&select=endpoint,p256dh,auth"
  );

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return (await res.json()) as PushRow[];
}

async function deactivateSubscription(endpoint: string) {
  await supabaseFetch(`web_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "PATCH",
    body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
  });
}

export async function sendPushNotification(payload: SendPushPayload) {
  configureWebPush();

  const rows = await fetchSubscriptions();
  const message = JSON.stringify({
    title: payload.title ?? "¡La asistencia está abierta!",
    body: payload.body ?? "El profesor habilitó la asistencia.",
    url: payload.url ?? "/asistencia",
    tag: payload.tag ?? "asistencia-abierta",
  });

  const results = await Promise.allSettled(
    rows.map((row) =>
      webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        message
      )
    )
  );

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
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}
