import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/webPush";

export const runtime = "nodejs";

type AsistenciaWebhookPayload = {
  materia?: string;
  source?: string;
  activeOptions?: { id: string; name: string }[];
};

async function updateAgentStatus(status: "listening" | "detected" | "idle", payload?: unknown) {
  await supabaseFetch("asistencia_agent_status?agent_id=eq.motorola-local", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status,
      last_seen_at: new Date().toISOString(),
      last_payload: payload ?? null,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFICATIONS_WEBHOOK_SECRET ?? "";
  const provided = req.headers.get("x-agent-secret") ?? req.headers.get("x-notify-secret") ?? "";
  if (secret && secret !== provided) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => ({}))) as AsistenciaWebhookPayload;
  const materia = payload.materia || payload.activeOptions?.[0]?.name;

  await updateAgentStatus("detected", payload);

  const result = await sendPushNotification({
    title: "¡La asistencia está abierta!",
    body: materia ? `Ya podés marcar asistencia en ${materia}.` : "Ya podés marcar asistencia.",
    url: "/asistencia",
    tag: "asistencia-abierta",
  });

  return NextResponse.json({ ok: true, ...result });
}
