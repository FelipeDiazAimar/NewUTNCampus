import { NextRequest, NextResponse } from "next/server";
import { sendPushNotification, type SendPushPayload } from "@/lib/webPush";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFICATIONS_WEBHOOK_SECRET ?? "";
  const provided = req.headers.get("x-notify-secret") ?? "";
  if (secret && secret !== provided) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const payload = (await req.json().catch(() => ({}))) as SendPushPayload;
    const result = await sendPushNotification(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "No se pudo enviar la notificacion" },
      { status: 500 }
    );
  }
}
