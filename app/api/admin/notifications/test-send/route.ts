import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { sendPushNotification, sendPushToUser } from "@/lib/webPush";

export const runtime = "nodejs";

const PAYLOAD = {
  title: "🔔 Prueba — Campus UTN",
  body: "Notificación de prueba. Si la ves, las push están funcionando.",
  url: "/asistencia",
  icon: "/logo.png",
};

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { target?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const payload = { ...PAYLOAD, tag: `test-${Date.now()}` }; // tag único => siempre aparece

  if (body.target === "email") {
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "Falta el email" }, { status: 400 });
    }
    const result = await sendPushToUser(email, payload);
    if (result.total === 0) {
      return NextResponse.json(
        { error: "Ese usuario no tiene suscripciones push activas" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, ...result });
  }

  if (body.target === "all") {
    const result = await sendPushNotification(payload);
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "target debe ser 'all' o 'email'" }, { status: 400 });
}
